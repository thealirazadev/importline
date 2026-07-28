import { mkdirSync, utimesSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, removeTestEnv } from "./setup";

const dir = createTestEnv();
const tempDir = path.join(dir, "uploads", "tmp");

type Queue = typeof import("@/lib/import/queue");
type Db = typeof import("@/lib/db");

let queue: Queue;
let db: Db;
let importId = 0;

beforeAll(async () => {
  db = await import("@/lib/db");
  await db.dbReady;
  const catalog = await db.prisma.catalog.create({ data: { name: "default" } });
  const created = await db.prisma.import.create({
    data: {
      catalogId: catalog.id,
      originalFilename: "products.csv",
      storedPath: path.join(dir, "uploads", "1-abc.csv"),
      fileSizeBytes: 10,
      fileSha256: "a".repeat(64),
      delimiter: ",",
      encoding: "utf-8",
      headerJson: JSON.stringify(["sku"]),
      state: "uploaded",
      batchSize: 1000,
    },
  });
  importId = created.id;
  queue = await import("@/lib/import/queue");
});

afterAll(async () => {
  await db.prisma.$disconnect();
  removeTestEnv(dir);
});

describe("job queue", () => {
  it("lets exactly one of two workers claim a queued job", async () => {
    const job = await queue.enqueueJob({ type: "validate", importId });
    const [first, second] = await Promise.all([
      queue.claimNextJob("worker-a"),
      queue.claimNextJob("worker-b"),
    ]);
    const winners = [first, second].filter((claimed) => claimed !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.id).toBe(job.id);
    await queue.finishJob(job.id, "done");
  });

  it("heartbeats only for the worker holding the job", async () => {
    const job = await queue.enqueueJob({ type: "apply", importId });
    const claimed = await queue.claimNextJob("worker-a");
    expect(claimed?.id).toBe(job.id);
    expect(await queue.heartbeatJob(job.id, "worker-a")).toBe(true);
    expect(await queue.heartbeatJob(job.id, "worker-b")).toBe(false);
    await queue.finishJob(job.id, "done");
  });

  it("reclaims a running job whose heartbeat went stale", async () => {
    const job = await queue.enqueueJob({ type: "apply", importId });
    await queue.claimNextJob("worker-a");
    await db.prisma.job.update({
      where: { id: job.id },
      data: { heartbeatAt: new Date(Date.now() - queue.STALE_JOB_MS - 1_000) },
    });

    expect(await queue.reclaimStaleJobs()).toBe(1);
    const reclaimed = await db.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(reclaimed.state).toBe("queued");
    expect(reclaimed.attempts).toBe(1);
    expect(reclaimed.lockedBy).toBeNull();

    const again = await queue.claimNextJob("worker-b");
    expect(again?.id).toBe(job.id);
    await queue.finishJob(job.id, "done");
  });

  it("sweeps orphan temp uploads older than a day and keeps fresh ones", async () => {
    mkdirSync(tempDir, { recursive: true });
    const stale = path.join(tempDir, "stale.part");
    const fresh = path.join(tempDir, "fresh.part");
    writeFileSync(stale, "x");
    writeFileSync(fresh, "x");
    const old = new Date(Date.now() - queue.ORPHAN_UPLOAD_MS - 60_000);
    utimesSync(stale, old, old);

    expect(await queue.sweepOrphanUploads()).toBe(1);
    expect(readdirSync(tempDir)).toEqual(["fresh.part"]);
  });
});
