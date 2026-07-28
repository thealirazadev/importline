import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, multipartBody, removeTestEnv } from "./setup";

const dir = createTestEnv({ maxFileMb: 1 });
const uploadsDir = path.join(dir, "uploads");

type Route = typeof import("@/app/api/imports/route");
type Db = typeof import("@/lib/db");

let route: Route;
let db: Db;

function request(parts: Parameters<typeof multipartBody>[0]): Request {
  const { body, contentType } = multipartBody(parts);
  return new Request("http://localhost/api/imports", {
    method: "POST",
    headers: { "content-type": contentType },
    body: new Uint8Array(body),
  });
}

beforeAll(async () => {
  db = await import("@/lib/db");
  await db.dbReady;
  await db.prisma.catalog.create({ data: { name: "default" } });
  route = await import("@/app/api/imports/route");
});

afterAll(async () => {
  await db.prisma.$disconnect();
  removeTestEnv(dir);
});

describe("POST /api/imports", () => {
  it("streams the file to disk, hashes it, and records the import", async () => {
    const content = Buffer.from("sku;name;price\nA-1;Anvil;9,99\nB-2;Bolt;1,50\n", "utf8");
    const response = await route.POST(
      request([
        { name: "catalog_id", value: "1" },
        { name: "source_label", value: "supplier-x" },
        { name: "file", filename: "products.csv", content },
      ]),
    );
    expect(response.status).toBe(201);

    const payload = (await response.json()) as { data: Record<string, unknown> };
    const expectedHash = createHash("sha256").update(content).digest("hex");
    expect(payload.data.file_sha256).toBe(expectedHash);
    expect(payload.data.delimiter).toBe(";");
    expect(payload.data.encoding).toBe("utf-8");
    expect(payload.data.state).toBe("uploaded");
    expect(payload.data.headers).toEqual(["sku", "name", "price"]);

    const stored = await db.prisma.import.findUniqueOrThrow({
      where: { id: payload.data.id as number },
    });
    expect(stored.storedPath).toBe(
      path.join(uploadsDir, `${stored.id}-${expectedHash.slice(0, 12)}.csv`),
    );
    expect(readFileSync(stored.storedPath)).toEqual(content);
    expect(readdirSync(path.join(uploadsDir, "tmp"))).toEqual([]);
  });

  it("rejects an upload over the size cap and leaves nothing behind", async () => {
    const before = await db.prisma.import.count();
    const oversize = Buffer.alloc(1024 * 1024 + 1024, 0x61);
    const response = await route.POST(
      request([
        { name: "catalog_id", value: "1" },
        { name: "file", filename: "big.csv", content: oversize },
      ]),
    );
    expect(response.status).toBe(413);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("file_too_large");
    expect(await db.prisma.import.count()).toBe(before);
    expect(readdirSync(path.join(uploadsDir, "tmp"))).toEqual([]);
  });

  it("rejects a request that is not multipart", async () => {
    const response = await route.POST(
      new Request("http://localhost/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(415);
  });

  it("rejects an unknown catalog", async () => {
    const response = await route.POST(
      request([
        { name: "catalog_id", value: "9999" },
        { name: "file", filename: "products.csv", content: Buffer.from("sku,name\nA,B\n") },
      ]),
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("validation_failed");
    expect(readdirSync(path.join(uploadsDir, "tmp"))).toEqual([]);
  });
});
