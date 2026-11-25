import { describe, expect, it } from "vitest";
import { loadEnv } from "@/lib/env";

describe("loadEnv", () => {
  it("uses the documented defaults when nothing is set", () => {
    expect(loadEnv({})).toEqual({
      DATABASE_URL: "file:./data/importline.db",
      IMPORTLINE_DATA_DIR: "./data/uploads",
      IMPORT_MAX_FILE_MB: 200,
      IMPORT_BATCH_SIZE: 1000,
      BATCH_MAX_ATTEMPTS: 3,
    });
  });

  it("accepts a SQLite file: URL and trims values", () => {
    const env = loadEnv({ DATABASE_URL: " file:/srv/importline.db ", IMPORT_BATCH_SIZE: "500" });
    expect(env.DATABASE_URL).toBe("file:/srv/importline.db");
    expect(env.IMPORT_BATCH_SIZE).toBe(500);
  });

  it.each(["postgresql://user@localhost/importline", "postgres://localhost/db", "mysql://x"])(
    "rejects the non-SQLite URL %s because the schema pins the sqlite provider",
    (url) => {
      expect(() => loadEnv({ DATABASE_URL: url })).toThrow(
        /DATABASE_URL must be a SQLite file: URL .*PostgreSQL is not supported yet/,
      );
    },
  );

  it("lists every problem at once", () => {
    let message = "";
    try {
      loadEnv({ DATABASE_URL: "postgresql://x", IMPORT_MAX_FILE_MB: "0", BATCH_MAX_ATTEMPTS: "a" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("IMPORT_MAX_FILE_MB must be an integer between 1 and 10240");
    expect(message).toContain("BATCH_MAX_ATTEMPTS must be an integer between 1 and 20");
    expect(message).toContain("DATABASE_URL must be a SQLite file: URL");
  });
});
