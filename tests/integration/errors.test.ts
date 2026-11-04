import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, removeTestEnv } from "./setup";

const dir = createTestEnv();

type Db = typeof import("@/lib/db");
type ListRoute = typeof import("@/app/api/imports/[id]/errors/route");
type CsvRoute = typeof import("@/app/api/imports/[id]/errors/csv/route");

let db: Db;
let listRoute: ListRoute;
let csvRoute: CsvRoute;
let importId = 0;

beforeAll(async () => {
  db = await import("@/lib/db");
  await db.dbReady;
  const catalog = await db.prisma.catalog.create({ data: { name: "default" } });
  const created = await db.prisma.import.create({
    data: {
      catalogId: catalog.id,
      originalFilename: "products.csv",
      storedPath: "/nonexistent/1.csv",
      fileSizeBytes: 10,
      fileSha256: "d".repeat(64),
      delimiter: ",",
      encoding: "utf-8",
      headerJson: JSON.stringify(["sku", "name", "price"]),
      state: "validated",
      batchSize: 1000,
    },
  });
  importId = created.id;
  await db.prisma.importRowError.createMany({
    data: [
      {
        importId,
        phase: "validate",
        rowNumber: 2,
        columnName: "price",
        code: "price_invalid",
        severity: "error",
        message: "Invalid price: invalid",
      },
      {
        importId,
        phase: "validate",
        rowNumber: 3,
        columnName: "sku",
        code: "duplicate_sku",
        severity: "warning",
        message: 'SKU "=cmd|calc" seen at row 2; last occurrence wins',
      },
    ],
  });
  listRoute = await import("@/app/api/imports/[id]/errors/route");
  csvRoute = await import("@/app/api/imports/[id]/errors/csv/route");
});

afterAll(async () => {
  await db.prisma.$disconnect();
  removeTestEnv(dir);
});

const params = () => ({ params: Promise.resolve({ id: String(importId) }) });
const list = (query: string) =>
  listRoute.GET(new Request(`http://localhost/api/imports/${importId}/errors${query}`), params());

describe("GET /api/imports/{id}/errors", () => {
  it("answers 400 for pagination that is not a positive integer", async () => {
    for (const query of ["?page=abc", "?page=0", "?per_page=abc", "?per_page=1000"]) {
      const response = await list(query);
      expect(response.status).toBe(400);
    }
  });

  it("pages through the report", async () => {
    const response = await list("?per_page=1&page=2");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[]; meta: Record<string, number> };
    expect(body.data).toHaveLength(1);
    expect(body.meta).toEqual({ page: 2, per_page: 1, total: 2 });
  });

  it("returns items in the documented shape", async () => {
    const body = (await (await list("")).json()) as { data: unknown[] };
    expect(body.data[0]).toEqual({
      row_number: 2,
      column: "price",
      code: "price_invalid",
      severity: "error",
      phase: "validate",
      message: "Invalid price: invalid",
    });
  });
});

describe("GET /api/imports/{id}/errors/csv", () => {
  it("downloads the documented columns with formula cells neutralized", async () => {
    const response = await csvRoute.GET(
      new Request(`http://localhost/api/imports/${importId}/errors/csv`),
      params(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="import-${importId}-report.csv"`,
    );
    expect((await response.text()).split("\n")).toEqual([
      "row_number,phase,severity,column,code,message",
      "2,validate,error,price,price_invalid,Invalid price: invalid",
      `3,validate,warning,sku,duplicate_sku,"SKU ""=cmd|calc"" seen at row 2; last occurrence wins"`,
      "",
    ]);
  });

  it("streams every row across page boundaries in row order", async () => {
    const big = await db.prisma.import.create({
      data: {
        catalogId: (await db.prisma.catalog.findFirstOrThrow()).id,
        originalFilename: "big.csv",
        storedPath: "/nonexistent/2.csv",
        fileSizeBytes: 10,
        fileSha256: "e".repeat(64),
        delimiter: ",",
        encoding: "utf-8",
        headerJson: JSON.stringify(["sku"]),
        state: "validated",
        batchSize: 1000,
      },
    });
    // Inserted in reverse so the output order comes from the query, not insertion order.
    const rows = Array.from({ length: 2500 }, (_, index) => ({
      importId: big.id,
      phase: "validate",
      rowNumber: 2501 - index,
      columnName: "sku",
      code: "missing_required",
      severity: "error",
      message: "SKU is required",
    }));
    await db.prisma.importRowError.createMany({ data: rows });

    const response = await csvRoute.GET(
      new Request(`http://localhost/api/imports/${big.id}/errors/csv`),
      { params: Promise.resolve({ id: String(big.id) }) },
    );
    const lines = (await response.text()).trimEnd().split("\n");
    expect(lines).toHaveLength(2501);
    const numbers = lines.slice(1).map((line) => Number(line.split(",")[0]));
    expect(numbers).toEqual(Array.from({ length: 2500 }, (_, index) => index + 2));
  });
});
