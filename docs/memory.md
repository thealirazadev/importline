# Project Memory - importline

Running log of what is done, in progress, and decided. Update after every meaningful chunk of
work; log every non-obvious decision with its reason. Keep entries short and dated.

## Completed

- 2026-07-27 - Planning documentation created (README, PRD, architecture, rules, phases, design,
  testing, api-contracts, launch-checklist, memory). No code yet; docs await owner review before
  Phase 1 starts.
- 2026-07-28 - Phase 1 shipped in its twelve listed commits: Next 15 + TypeScript strict +
  Tailwind scaffold with ESLint/Prettier/Vitest, validated env access, Prisma schema and the
  initial migration for every documented table, db client + structured logger + error envelope,
  default catalog seed and the catalogs API, encoding/delimiter detection, the streamed upload
  endpoint, imports list and detail APIs, the job queue with atomic claim and heartbeat, the
  worker process with janitor, the upload and history pages, and the detection/upload/queue
  tests.

## Project status

- Phase 1 complete and verified locally; Phase 2 (mapping, normalization, validation pass) not
  started and awaiting owner approval.
- Observed on 2026-07-28: `npm run build`, `npm run typecheck`, and `npm run lint` clean;
  `npm test` green with 17 tests across 3 files (detection unit, upload integration, queue
  integration). Manual checks: comma, semicolon, tab, and pipe files detected correctly; a
  UTF-16 LE (BOM) file and a Windows-1252 file decoded correctly from the stored file; an
  upload over the cap returned the 413 envelope with no import row and no leftover temp file;
  a curl abort mid-stream left no import row and no temp file; the empty history state renders;
  web and worker ran together against one SQLite file in WAL mode (worker.started and
  job.claimed logged while the web process served requests).
- Web-process memory during a 148 MB upload: RSS moved between 165 MB and 235 MB and returned
  to the same band over three consecutive uploads, so nothing accumulates per upload (the churn
  is chunk-sized buffer garbage, not file buffering).
- Not verified yet, by design of the phase: a real SIGKILL reclaim (Phase 1 has no long-running
  job body, so reclaim is covered by the stale-heartbeat integration test only), PostgreSQL
  (Phase 5), and the 500,000-row scale runs (Phase 2 soak job).

## Decisions log

- 2026-07-27 - Separate tsx worker process instead of the cron-hit job route pulse-analytics
  uses (its docs/architecture.md was checked before deciding). An apply over 500k rows runs for
  minutes, must heartbeat, must survive web-process deploys, and cannot live inside a request
  timeout; pulse-analytics' rollup is a bounded five-minute recompute, which is a different
  shape. The worker shares `lib/` and the Prisma client, so there is no second build pipeline.
- 2026-07-27 - Prisma over Drizzle despite pulse-analytics using Drizzle. That project's core is
  hand-written aggregation SQL; this project's core is transactions plus unique constraints over
  plain CRUD, which Prisma expresses directly, and Prisma's migrations keep the SQLite/Postgres
  dual-engine story simple. Not a portfolio inconsistency: the tool follows the workload.
- 2026-07-27 - The ledger insert is the first statement inside each batch transaction, so a
  duplicate application of an already-committed batch aborts on the unique constraint before any
  product write becomes possible. At-least-once retries plus this dedupe is the whole
  exactly-once story; there is deliberately no second mechanism to keep consistent.
- 2026-07-27 - The row content hash covers only mapped fields (sorted by field name, values
  normalized, price as cents). Consequence: identical file + identical mapping re-imports as all
  skips (the idempotency requirement), while changing the mapping intentionally re-applies rows
  because a different field set would be written. The alternative (hashing the raw CSV line) was
  rejected: cosmetic formatting differences ("9,99" vs "9.99") would defeat skip detection.
- 2026-07-27 - Price normalization uses one deterministic locale-free rule (rightmost separator
  wins when both appear; a single separator followed by exactly 3 digits is thousands) instead
  of a per-import locale setting. The one theoretically ambiguous form, "1,234" as one point two
  three four, would be rejected anyway by the 2-decimal precision rule, so the rule is lossless
  in practice; documented in architecture with that argument.
- 2026-07-27 - No authentication in v1, unlike every other web app in this portfolio. Single
  operator on localhost or a trusted network; auth would touch every route, page, and test for
  no v1 user. The launch checklist makes the reverse-proxy expectation explicit, and rules.md
  forbids adding ad hoc auth without owner approval so it stays a deliberate gap, not drift.
- 2026-07-28 - JSON columns (header_json, mapping_json, fields_json) are TEXT, not a Json
  scalar: the Prisma SQLite connector has no Json type, and one schema has to serve SQLite and
  PostgreSQL. Length caps (sku 64, name 256, and the rest) stay in the normalization rules
  rather than in engine-specific column types, which keeps the same file valid for both
  providers. Column and table names are exactly the ones in docs/architecture.md.
- 2026-07-28 - `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` run once per process
  from lib/db.ts, guarded by a `file:` provider check, and go through `$queryRawUnsafe` because
  both pragmas answer with a row. This is the only engine-specific SQL in the codebase; WAL is
  persisted in the database file, and the busy timeout applies to the connection that ran it.
- 2026-07-28 - The server-only guard on lib/env.ts and lib/db.ts is a `typeof window` throw
  instead of the `server-only` package, because a new dependency needs owner approval and the
  throw gives the same protection for free.
- 2026-07-28 - lib/upload.ts implements a streaming multipart reader instead of calling
  `request.formData()`, which buffers the whole file in memory through undici and would break
  the bounded-memory rule outright. It writes the file part to a temp file while keeping only a
  hash context, a byte counter, and the 64 KB detection sample, and it enforces the size cap
  while streaming. This module is not in the file tree in docs/architecture.md; flagging it
  here rather than editing that document.
- 2026-07-28 - lib/import/serialize.ts holds the import API shapes so the list and detail routes
  cannot drift apart. Also an addition to the documented tree, same reason.
- 2026-07-28 - lib/logger.ts carries four error-path events beyond the list in docs/rules.md:
  api.failed, job.failed, worker.failed, janitor.failed. The documented set is what must exist,
  and every failure still leaves one structured line rather than an unstructured throw.
- 2026-07-28 - The uploaded file is stored as `<import id>-<sha256 prefix>.csv`, so the row is
  created first (with the temp path), then the file is renamed and the path updated. A failed
  rename deletes the row, so no import can point at a file that does not exist. The 413 and
  abort paths run before any row is created, which is what keeps them free of orphan rows.
- 2026-07-28 - worker/index.ts decides whether it was started directly by inspecting
  `process.argv[1]` rather than `import.meta.url`: the package is CommonJS, so tsx transforms
  the worker to CJS where import.meta is unavailable. Tests import the module without starting
  the poll loop.
- 2026-07-28 - tsx entry points (`npm run worker`, `npm run seed`) load configuration with
  node's `--env-file-if-exists=.env` instead of a dotenv dependency; Next loads .env for the web
  process itself.
- 2026-07-28 - Prisma resolves a relative SQLite path against the schema directory, so the
  default `file:./data/importline.db` puts the development database at prisma/data/importline.db
  (git-ignored). Integration tests set an absolute `file:` URL into a temp directory and run
  `prisma migrate deploy` there, so they exercise the real migration.
- 2026-07-28 - The test scripts pass `--passWithNoTests` so that every commit in the phase, not
  just the last one, is green before tests exist. `matched_template` in the upload response is
  null until the templates lookup lands in Phase 2.
