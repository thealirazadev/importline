import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Job, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { logError, logInfo } from "../logger";

/** Database-backed job queue: enqueue, atomic claim, heartbeat, janitor. */

export const JOB_TYPES = ["validate", "apply"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const POLL_INTERVAL_MS = 2_000;
export const IDLE_POLL_INTERVAL_MS = 5_000;
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const STALE_JOB_MS = 60_000;
export const ORPHAN_UPLOAD_MS = 24 * 60 * 60 * 1000;

const LAST_ERROR_MAX = 512;

type DbClient = PrismaClient | Prisma.TransactionClient;

export function createWorkerId(): string {
  return `${hostname()}-${process.pid}-${randomBytes(4).toString("hex")}`.slice(0, 64);
}

/**
 * Only the state-machine transitions call this, so an import never holds two live jobs.
 * Accepts a transaction client so the enqueue commits with the transition that caused it.
 */
export async function enqueueJob(
  input: { type: JobType; importId: number; runAfter?: Date },
  client: DbClient = prisma,
): Promise<Job> {
  return client.job.create({
    data: {
      type: input.type,
      importId: input.importId,
      state: "queued",
      runAfter: input.runAfter ?? new Date(),
    },
  });
}

/**
 * Compare-and-set claim: the update only succeeds while the row is still `queued`, so two
 * workers racing for the same job produce exactly one winner on SQLite and PostgreSQL alike.
 */
export async function claimNextJob(workerId: string, now: Date = new Date()): Promise<Job | null> {
  for (;;) {
    const candidate = await prisma.job.findFirst({
      where: { state: "queued", runAfter: { lte: now } },
      orderBy: { id: "asc" },
    });
    if (candidate === null) return null;

    const claimed = await prisma.job.updateMany({
      where: { id: candidate.id, state: "queued" },
      data: { state: "running", lockedBy: workerId, heartbeatAt: new Date() },
    });
    if (claimed.count === 0) continue; // another worker won this row; try the next one

    const job = await prisma.job.findUnique({ where: { id: candidate.id } });
    if (job === null) continue;
    logInfo("job.claimed", {
      job_id: job.id,
      import_id: job.importId,
      type: job.type,
      worker_id: workerId,
    });
    return job;
  }
}

/** Returns false when the job is no longer ours, which tells the worker to stop its work. */
export async function heartbeatJob(jobId: number, workerId: string): Promise<boolean> {
  const updated = await prisma.job.updateMany({
    where: { id: jobId, state: "running", lockedBy: workerId },
    data: { heartbeatAt: new Date() },
  });
  return updated.count === 1;
}

export async function finishJob(
  jobId: number,
  state: "done" | "failed",
  lastError?: string,
): Promise<void> {
  await prisma.job.updateMany({
    where: { id: jobId },
    data: {
      state,
      lastError: lastError === undefined ? null : lastError.slice(0, LAST_ERROR_MAX),
    },
  });
}

/** Janitor: a running job whose worker stopped heartbeating goes back on the queue. */
export async function reclaimStaleJobs(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_JOB_MS);
  const stale = await prisma.job.findMany({
    where: { state: "running", heartbeatAt: { lt: cutoff } },
    orderBy: { id: "asc" },
  });
  let reclaimed = 0;
  for (const job of stale) {
    const updated = await prisma.job.updateMany({
      where: { id: job.id, state: "running", heartbeatAt: job.heartbeatAt },
      data: {
        state: "queued",
        attempts: job.attempts + 1,
        lockedBy: null,
        heartbeatAt: null,
        runAfter: new Date(),
      },
    });
    if (updated.count === 1) {
      reclaimed += 1;
      logInfo("job.reclaimed", {
        job_id: job.id,
        import_id: job.importId,
        attempts: job.attempts + 1,
      });
    }
  }
  return reclaimed;
}

/** Janitor: temp parts left by aborted uploads are deleted once they are a day old. */
export async function sweepOrphanUploads(now: Date = new Date()): Promise<number> {
  const tempDir = path.join(env.IMPORTLINE_DATA_DIR, "tmp");
  let entries: string[];
  try {
    entries = await readdir(tempDir);
  } catch {
    return 0; // nothing uploaded yet
  }
  const cutoff = now.getTime() - ORPHAN_UPLOAD_MS;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".part")) continue;
    const target = path.join(tempDir, entry);
    try {
      const info = await stat(target);
      if (info.mtimeMs < cutoff) {
        await unlink(target);
        removed += 1;
      }
    } catch (error) {
      logError("janitor.failed", error, { orphan_file: entry });
    }
  }
  return removed;
}
