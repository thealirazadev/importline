import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, removeTestEnv } from "./setup";

const dir = createTestEnv();
const uploadsDir = path.join(dir, "uploads");

type Db = typeof import("@/lib/db");
type Route = typeof import("@/app/api/imports/[id]/mapping/route");
type Worker = typeof import("@/worker/index");

let db: Db;
let route: Route;
let worker: Worker;
let catalogId = 0;
let fileCount = 0;

beforeAll(async () => {
  db = await import("@/lib/db");
  await db.dbReady;
  catalogId = (await db.prisma.catalog.create({ data: { name: "default" } })).id;
  route = await import("@/app/api/imports/[id]/mapping/route");
  worker = await import("@/worker/index");
  mkdirSync(uploadsDir, { recursive: true });
});

afterAll(async () => {
  await db.prisma.$disconnect();
  removeTestEnv(dir);
});

const CSV = "SKU;Title;Price EUR;Qty\nA-1;Anvil;9,99;3\nB-2;Bolt;1,50;x\n";

async function createImport(state = "uploaded") {
  fileCount += 1;
  const storedPath = path.join(uploadsDir, `mapping-${fileCount}.csv`);
  writeFileSync(storedPath, CSV, "utf8");
  return db.prisma.import.create({
    data: {
      catalogId,
      originalFilename: "products.csv",
      storedPath,
      fileSizeBytes: Buffer.byteLength(CSV),
      fileSha256: "c".repeat(64),
      delimiter: ";",
      encoding: "utf-8",
      headerJson: JSON.stringify(["SKU", "Title", "Price EUR", "Qty"]),
      state,
      batchSize: 1000,
    },
  });
}

function put(id: number, body: string) {
  return route.PUT(
    new Request(`http://localhost/api/imports/${id}/mapping`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

const MAPPING = { SKU: "sku", Title: "name", "Price EUR": "price", Qty: "stock" };

describe("PUT /api/imports/{id}/mapping", () => {
  it("accepts the documented header to field shape and validates with it", async () => {
    const created = await createImport();
    const response = await put(
      created.id,
      JSON.stringify({ mapping: MAPPING, save_template: "supplier-x" }),
    );
    expect(response.status).toBe(200);

    expect(await worker.pollOnce("worker-test")).toBe(true);
    const row = await db.prisma.import.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.state).toBe("validated");
    expect(row.totalRows).toBe(2);
    const errors = await db.prisma.importRowError.findMany({ where: { importId: created.id } });
    expect(errors.map((error) => [error.rowNumber, error.columnName, error.code])).toEqual([
      [3, "Qty", "stock_invalid"],
    ]);

    const template = await db.prisma.mappingTemplate.findUniqueOrThrow({
      where: { name: "supplier-x" },
    });
    expect(JSON.parse(template.mappingJson)).toEqual(MAPPING);
  });

  it("rejects a field-keyed mapping with per-header details", async () => {
    const created = await createImport();
    const response = await put(
      created.id,
      JSON.stringify({ mapping: { sku: "SKU", name: "Title", price: "Price EUR" } }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_failed");
  });

  it("answers 400 for a body that is not valid JSON", async () => {
    const created = await createImport();
    const response = await put(created.id, "{not json");
    expect(response.status).toBe(400);
  });

  it("rejects an over-long or path-like template name", async () => {
    const created = await createImport();
    for (const name of ["x".repeat(129), "a/b"]) {
      const response = await put(
        created.id,
        JSON.stringify({ mapping: MAPPING, save_template: name }),
      );
      expect(response.status).toBe(400);
    }
    const row = await db.prisma.import.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.state).toBe("uploaded");
  });

  it("answers 409 and enqueues nothing when the import is past mapping", async () => {
    const created = await createImport("applying");
    const response = await put(created.id, JSON.stringify({ mapping: MAPPING }));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("state_conflict");
    expect(await db.prisma.job.count({ where: { importId: created.id } })).toBe(0);
  });
});
