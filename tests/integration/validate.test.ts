import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, multipartBody, removeTestEnv } from "./setup";

const dir = createTestEnv({ maxFileMb: 1 });

type Db = typeof import("@/lib/db");
let db: Db;
let uploadRoute: typeof import("@/app/api/imports/route");
let mappingRoute: typeof import("@/app/api/imports/[id]/mapping/route");
let errorsRoute: typeof import("@/app/api/imports/[id]/errors/route");
let csvRoute: typeof import("@/app/api/imports/[id]/errors/csv/route");
let worker: typeof import("@/worker/index");

const MESSY = [
  "SKU;Name;Price;Stock;Link",
  "A-1;Linen shirt;19,99;12;https://shop.example/a1",
  "A-2;Wool scarf;1.299,00 €;3;https://shop.example/a2",
  "A-3;Cap;abc;5;https://shop.example/a3",
  ";No sku item;10,00;1;https://shop.example/x",
  "A-5;Short row;5,00",
  `A-6;${"x".repeat(300)};7,50;2;https://shop.example/a6`,
  "A-7;Bad link;8,00;2;not a url",
  "A-1;Duplicate shirt;19,99;12;https://shop.example/a1b",
  "A-9;Neg stock;4,00;-3;https://shop.example/a9",
].join("\n");
const MAPPING = { SKU: "sku", Name: "name", Price: "price", Stock: "stock", Link: "image_url" };

const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

async function upload(): Promise<{ id: number; matched_template: unknown }> {
  const { body, contentType } = multipartBody([
    { name: "catalog_id", value: "1" },
    { name: "file", filename: "messy.csv", content: Buffer.from(MESSY + "\n", "utf8") },
  ]);
  const response = await uploadRoute.POST(
    new Request("http://localhost/api/imports", {
      method: "POST",
      headers: { "content-type": contentType },
      body: new Uint8Array(body),
    }),
  );
  return ((await response.json()) as { data: { id: number; matched_template: unknown } }).data;
}

function putMapping(id: number, payload: unknown) {
  return mappingRoute.PUT(
    new Request(`http://localhost/api/imports/${id}/mapping`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    params(id),
  );
}

beforeAll(async () => {
  db = await import("@/lib/db");
  await db.dbReady;
  await db.prisma.catalog.create({ data: { name: "default" } });
  uploadRoute = await import("@/app/api/imports/route");
  mappingRoute = await import("@/app/api/imports/[id]/mapping/route");
  errorsRoute = await import("@/app/api/imports/[id]/errors/route");
  csvRoute = await import("@/app/api/imports/[id]/errors/csv/route");
  worker = await import("@/worker/index");
});

afterAll(async () => {
  await db.prisma.$disconnect();
  removeTestEnv(dir);
});

describe("mapping, validation job, and the row report", () => {
  it("rejects a mapping without price, with the field named", async () => {
    const { id } = await upload();
    const response = await putMapping(id, { mapping: { SKU: "sku", Name: "name" } });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { details: Record<string, string> } };
    expect(Object.keys(body.error.details)).toEqual(["price"]);
  });

  it("validates through the worker and reports every documented code at its spreadsheet row", async () => {
    const { id } = await upload();
    const saved = await putMapping(id, { mapping: MAPPING, save_template: "supplier-x" });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { data: { state: string } }).data.state).toBe("validating");

    expect(await worker.pollOnce("test-worker")).toBe(true);

    const row = await db.prisma.import.findUniqueOrThrow({ where: { id } });
    expect([row.state, row.totalRows, row.errorRows, row.warningRows]).toEqual([
      "validated",
      9,
      6,
      1,
    ]);
    expect([row.wouldCreate, row.wouldUpdate]).toEqual([2, 0]);

    const listed = await errorsRoute.GET(
      new Request(`http://localhost/api/imports/${id}/errors`),
      params(id),
    );
    const report = ((await listed.json()) as { data: Array<Record<string, unknown>> }).data;
    expect(report.map((e) => [e.row_number, e.code])).toEqual([
      [4, "price_invalid"],
      [5, "missing_required"],
      [6, "columns_mismatch"],
      [7, "field_too_long"],
      [8, "url_invalid"],
      [9, "duplicate_sku"],
      [10, "stock_negative"],
    ]);

    const csv = await (await csvRoute.GET(new Request(`http://localhost/x`), params(id))).text();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("row_number,phase,severity,column,code,message");
    expect(lines).toHaveLength(report.length + 1);
  });

  it("pre-fills a second upload with the same headers from the saved template", async () => {
    const { matched_template } = await upload();
    expect(matched_template).toMatchObject({ name: "supplier-x", mapping: MAPPING });
  });
});
