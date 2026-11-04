import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, removeTestEnv } from "./setup";

const dir = createTestEnv();
const uploadsDir = path.join(dir, "uploads");

type Db = typeof import("@/lib/db");
type Worker = typeof import("@/worker/index");
type Queue = typeof import("@/lib/import/queue");
type Validation = typeof import("@/lib/validate/job");

let db: Db;
let worker: Worker;
let queue: Queue;
let validation: Validation;
let catalogId = 0;
let fileCount = 0;

beforeAll(async () => {
  db = await import("@/lib/db");
  await db.dbReady;
  const catalog = await db.prisma.catalog.create({ data: { name: "default" } });
  catalogId = catalog.id;
  worker = await import("@/worker/index");
  queue = await import("@/lib/import/queue");
  validation = await import("@/lib/validate/job");
  mkdirSync(uploadsDir, { recursive: true });
});

afterAll(async () => {
  await db.prisma.$disconnect();
  removeTestEnv(dir);
});

const MAPPING = { sku: "sku", name: "name", price: "price", stock: "stock" };

async function createImport(csv: string, mapping: Record<string, string> = MAPPING) {
  fileCount += 1;
  const storedPath = path.join(uploadsDir, `validate-${fileCount}.csv`);
  writeFileSync(storedPath, csv, "utf8");
  const headers = csv.split(/\r?\n/)[0].split(",");
  return db.prisma.import.create({
    data: {
      catalogId,
      originalFilename: "products.csv",
      storedPath,
      fileSizeBytes: Buffer.byteLength(csv),
      fileSha256: "b".repeat(64),
      delimiter: ",",
      encoding: "utf-8",
      headerJson: JSON.stringify(headers),
      mappingJson: JSON.stringify(mapping),
      state: "validating",
      batchSize: 1000,
    },
  });
}

async function validate(csv: string, mapping?: Record<string, string>) {
  const created = await createImport(csv, mapping);
  await queue.enqueueJob({ type: "validate", importId: created.id });
  expect(await worker.pollOnce("worker-test")).toBe(true);
  const row = await db.prisma.import.findUniqueOrThrow({ where: { id: created.id } });
  const errors = await db.prisma.importRowError.findMany({
    where: { importId: created.id },
    orderBy: [{ rowNumber: "asc" }, { id: "asc" }],
  });
  return { row, errors };
}

describe("validation job", () => {
  it("is run by the worker when a validate job is claimed", async () => {
    const { row, errors } = await validate(
      "sku,name,price,stock\nA-1,Anvil,9.99,3\nB-2,Bolt,1.50,\n",
    );
    expect(row.state).toBe("validated");
    expect(row.totalRows).toBe(2);
    expect(row.errorRows).toBe(0);
    expect(row.wouldCreate).toBe(2);
    expect(errors).toEqual([]);
  });

  it("reports CSV record numbers, counting the header as row 1", async () => {
    const csv = "sku,name,price,stock\nA-1,Anvil,9.99,3\n\nB-2,,1.50,1\nA-1,Anvil,9.99,3\n";
    const { row, errors } = await validate(csv);
    expect(row.totalRows).toBe(3);
    expect(errors.map((error) => [error.rowNumber, error.code])).toEqual([
      [4, "missing_required"],
      [5, "duplicate_sku"],
    ]);
    expect(errors[1].message).toContain("row 2");
  });

  it("stops and cancels when cancellation was requested", async () => {
    const created = await createImport("sku,name,price,stock\nA-1,Anvil,9.99,3\n");
    await db.prisma.import.update({ where: { id: created.id }, data: { cancelRequested: true } });
    await queue.enqueueJob({ type: "validate", importId: created.id });
    await worker.pollOnce("worker-test");
    const row = await db.prisma.import.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.state).toBe("cancelled");
  });

  it("accepts exactly the row limit even with trailing blank lines", async () => {
    const created = await createImport("sku,name,price,stock\nA-1,A,1,1\nB-2,B,1,1\n\n");
    await validation.runValidationJob(created.id, { rowLimit: 2 });
    const row = await db.prisma.import.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.state).toBe("validated");
    expect(row.totalRows).toBe(2);
  });

  it("fails a file with more data rows than the limit", async () => {
    const created = await createImport("sku,name,price,stock\nA-1,A,1,1\nB-2,B,1,1\nC-3,C,1,1\n");
    await validation.runValidationJob(created.id, { rowLimit: 2 });
    const row = await db.prisma.import.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.state).toBe("failed");
    expect(row.pauseReason).toBe("row_limit_exceeded");
  });
});
