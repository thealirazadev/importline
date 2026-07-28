import type { Job } from "@prisma/client";
import { dbReady, prisma } from "../lib/db";
import { logError, logInfo } from "../lib/logger";
import {
  HEARTBEAT_INTERVAL_MS,
  IDLE_POLL_INTERVAL_MS,
  POLL_INTERVAL_MS,
  claimNextJob,
  createWorkerId,
  finishJob,
  heartbeatJob,
  reclaimStaleJobs,
  sweepOrphanUploads,
} from "../lib/import/queue";

/** Long-running worker: claim a job, heartbeat while it runs, sweep stale work when idle. */

const JANITOR_INTERVAL_MS = 30_000;

let stopping = false;

export function requestStop(): void {
  stopping = true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Phase 1 has no job bodies yet: validate lands in phase 2 and apply in phase 3, both as
 * modules called from here. Until then a claimed job is completed as a no-op.
 */
async function runJobBody(job: Job): Promise<void> {
  void job;
}

export async function runClaimedJob(job: Job, workerId: string): Promise<void> {
  const heartbeat = setInterval(() => {
    void heartbeatJob(job.id, workerId).catch((error: unknown) => {
      logError("job.failed", error, { job_id: job.id, import_id: job.importId, task: "heartbeat" });
    });
  }, HEARTBEAT_INTERVAL_MS);
  try {
    await runJobBody(job);
    await finishJob(job.id, "done");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("job.failed", error, { job_id: job.id, import_id: job.importId });
    await finishJob(job.id, "failed", message).catch((failure: unknown) => {
      logError("job.failed", failure, { job_id: job.id });
    });
  } finally {
    clearInterval(heartbeat);
  }
}

/** One poll tick. Returns true when a job was claimed and run. */
export async function pollOnce(workerId: string): Promise<boolean> {
  const job = await claimNextJob(workerId);
  if (job === null) return false;
  await runClaimedJob(job, workerId);
  return true;
}

export async function runJanitor(): Promise<void> {
  try {
    await reclaimStaleJobs();
  } catch (error) {
    logError("janitor.failed", error, { task: "reclaim_stale_jobs" });
  }
  try {
    await sweepOrphanUploads();
  } catch (error) {
    logError("janitor.failed", error, { task: "sweep_orphan_uploads" });
  }
}

export async function runWorker(): Promise<void> {
  await dbReady;
  const workerId = createWorkerId();
  logInfo("worker.started", { worker_id: workerId, pid: process.pid });

  let lastJanitorAt = 0;
  while (!stopping) {
    let worked = false;
    try {
      if (Date.now() - lastJanitorAt >= JANITOR_INTERVAL_MS) {
        lastJanitorAt = Date.now();
        await runJanitor();
      }
      worked = await pollOnce(workerId);
    } catch (error) {
      logError("worker.failed", error, { worker_id: workerId });
    }
    if (!stopping) await sleep(worked ? POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      requestStop();
    });
  }
  try {
    await runWorker();
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

// Started as `npm run worker`; importing this module from tests must not start the loop.
const startedDirectly =
  process.argv[1] !== undefined && /worker[\\/]index\.tsx?$/.test(process.argv[1]);
if (startedDirectly) {
  void main();
}
