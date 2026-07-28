/**
 * Validated process configuration. Imported by server code only; reading it from a client
 * component throws instead of silently shipping configuration to the browser.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/env.ts is server-only and must not be imported from a client component");
}

export type Env = {
  DATABASE_URL: string;
  IMPORTLINE_DATA_DIR: string;
  IMPORT_MAX_FILE_MB: number;
  IMPORT_BATCH_SIZE: number;
  BATCH_MAX_ATTEMPTS: number;
};

const DEFAULTS = {
  DATABASE_URL: "file:./data/importline.db",
  IMPORTLINE_DATA_DIR: "./data/uploads",
  IMPORT_MAX_FILE_MB: 200,
  IMPORT_BATCH_SIZE: 1000,
  BATCH_MAX_ATTEMPTS: 3,
} as const;

function readString(name: keyof Env, fallback: string, errors: string[]): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim();
  if (value.includes("\0")) {
    errors.push(`${name} must not contain null bytes`);
    return fallback;
  }
  return value;
}

function readInt(name: keyof Env, fallback: number, min: number, max: number, errors: string[]) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
    return fallback;
  }
  return value;
}

function loadEnv(): Env {
  const errors: string[] = [];
  const parsed: Env = {
    DATABASE_URL: readString("DATABASE_URL", DEFAULTS.DATABASE_URL, errors),
    IMPORTLINE_DATA_DIR: readString("IMPORTLINE_DATA_DIR", DEFAULTS.IMPORTLINE_DATA_DIR, errors),
    IMPORT_MAX_FILE_MB: readInt(
      "IMPORT_MAX_FILE_MB",
      DEFAULTS.IMPORT_MAX_FILE_MB,
      1,
      10_240,
      errors,
    ),
    IMPORT_BATCH_SIZE: readInt("IMPORT_BATCH_SIZE", DEFAULTS.IMPORT_BATCH_SIZE, 1, 100_000, errors),
    BATCH_MAX_ATTEMPTS: readInt("BATCH_MAX_ATTEMPTS", DEFAULTS.BATCH_MAX_ATTEMPTS, 1, 20, errors),
  };

  if (!/^(file:|postgresql:|postgres:)/.test(parsed.DATABASE_URL)) {
    errors.push("DATABASE_URL must start with file: or postgresql:");
  }
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join("\n- ")}`);
  }
  return Object.freeze(parsed);
}

export const env = loadEnv();
