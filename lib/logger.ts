/** Structured logging: exactly one JSON line per event, on stdout. */

export type LogEvent =
  | "import.uploaded"
  | "import.detected"
  | "mapping.saved"
  | "validate.started"
  | "validate.completed"
  | "validate.failed"
  | "apply.started"
  | "batch.applied"
  | "batch.retry"
  | "batch.failed"
  | "import.paused"
  | "import.resumed"
  | "import.cancelled"
  | "import.completed"
  | "import.failed"
  | "lock.acquired"
  | "lock.released"
  | "lock.takeover"
  | "job.claimed"
  | "job.reclaimed"
  | "worker.started"
  | "api.failed"
  | "janitor.failed"
  | "job.failed"
  | "worker.failed";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

function write(level: "info" | "error", event: LogEvent, fields: LogFields): void {
  const entry = { ts: new Date().toISOString(), level, event, ...fields };
  try {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  } catch {
    // A broken stdout must never take the process down.
  }
}

export function logInfo(event: LogEvent, fields: LogFields = {}): void {
  write("info", event, fields);
}

/** Logs the detailed side of a failure; user-facing messages never carry this text. */
export function logError(event: LogEvent, error: unknown, fields: LogFields = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  write("error", event, { ...fields, error: message });
}
