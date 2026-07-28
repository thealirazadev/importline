import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Each integration file gets its own SQLite file (not :memory:, because the web and worker
 * semantics depend on a shared file in WAL mode) with the real migrations applied.
 * Call this before importing any module that reads lib/env or lib/db.
 */
export function createTestEnv(options: { maxFileMb?: number } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "importline-test-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
  process.env.IMPORTLINE_DATA_DIR = path.join(dir, "uploads");
  process.env.IMPORT_MAX_FILE_MB = String(options.maxFileMb ?? 200);
  process.env.IMPORT_BATCH_SIZE = "1000";
  process.env.BATCH_MAX_ATTEMPTS = "3";

  const cli = path.join(process.cwd(), "node_modules", ".bin", "prisma");
  execFileSync(cli, ["migrate", "deploy"], {
    env: process.env,
    stdio: "ignore",
  });
  return dir;
}

export function removeTestEnv(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function multipartBody(
  parts: Array<{ name: string; value?: string; filename?: string; content?: Buffer }>,
): { body: Buffer; contentType: string } {
  const boundary = "----importlinetest8f2a1c";
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition =
      part.filename === undefined
        ? `form-data; name="${part.name}"`
        : `form-data; name="${part.name}"; filename="${part.filename}"`;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\n\r\n`));
    chunks.push(part.content ?? Buffer.from(part.value ?? ""));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
