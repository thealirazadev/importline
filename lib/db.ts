import { PrismaClient } from "@prisma/client";
import { env } from "./env";

if (typeof window !== "undefined") {
  throw new Error("lib/db.ts is server-only and must not be imported from a client component");
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaReady?: Promise<void>;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

const isSqlite = env.DATABASE_URL.startsWith("file:");

/**
 * SQLite needs WAL (so the web and worker processes can write concurrently) and a busy timeout.
 * These are the only engine-specific statements in the codebase and they are guarded by provider.
 * WAL is persisted in the database file; busy_timeout applies to the connection that runs it.
 */
async function applySqlitePragmas(client: PrismaClient): Promise<void> {
  if (!isSqlite) return;
  try {
    // Both pragmas answer with a row, so they go through $queryRawUnsafe.
    await client.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
    await client.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`sqlite pragma setup failed: ${message}\n`);
  }
}

/** Await before the first query when the pragmas must be in force (worker start, tests). */
export const dbReady: Promise<void> =
  globalForPrisma.prismaReady ?? applySqlitePragmas(prisma).then(() => undefined);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaReady = dbReady;
}
