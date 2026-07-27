# Architecture - importline

## App flow

```
POST /api/imports -- stream multipart body to temp file with size counter (413 over cap),
  |                  sha256 while streaming, atomic rename into IMPORTLINE_DATA_DIR,
  |                  detect encoding + delimiter from first 64 KB, create imports row
  v
uploaded --> mapping screen; PUT mapping (sku, name, price required; optional overrides)
  v
validating -- validate job enqueued; worker (tsx) claims atomically, heartbeats every 10 s,
  |   streams decode -> parse (papaparse) -> normalize -> validate per row,
  |   writes import_row_errors, computes dry-run counts, memory bounded
  v
validated -- report + would-create/update/skip shown; POST apply (conditional transition)
  v
applying -- apply job: acquire catalog lock, stream file again, re-normalize,
  |   group valid rows into 1000-row batches; per batch, one transaction:
  |     insert import_batches (unique import_id+batch_number) FIRST;
  |     upsert products by (catalog_id, sku) with hash skip;
  |     write import_changes audit; bump imports counters; COMMIT
  |   batch failure -> retry with backoff; 3 strikes -> paused
  |   cancel_requested checked between batches -> cancelled
  v
completed -- history shows stats; audit browsable; lock released
```

The UI polls `GET /api/imports/{id}/status` (a single-row read) every 2 s while active.

## Import state machine

States live on `imports.state`. Every transition is a conditional update (`UPDATE ... WHERE id = ?
AND state = ?`, checked row count); a lost race returns 409. The only allowed transitions:

| From | To | Trigger |
|---|---|---|
| - | `uploaded` | Upload stored, detection complete |
| `uploaded`/`validated` | `validating` | Mapping saved (first save or re-save); validate job enqueued |
| `validating` | `validated` | Validation finished (report + dry-run counts written) |
| `validating`/`applying` | `failed` | File unreadable/missing, hash mismatch, row count over 500,000, or unrecoverable error; lock released if held |
| `validated` | `applying` | Operator applies; apply job enqueued |
| `applying` | `completed` | Final batch committed; lock released |
| `applying` | `paused` | Batch retries exhausted, catalog lock unavailable, or job crash loop |
| `validating`/`applying` | `cancelled` | Cancel requested; worker stops at the next chunk/batch boundary; lock released |
| `paused`/`cancelled` | `applying` | Operator resumes (cancelled only if it had entered applying); fresh job, fresh retry budget |
| `uploaded`/`validated` | `cancelled` | Operator abandons before applying |

`failed`, `completed`, and pre-apply `cancelled` are terminal; `paused` always records a reason.

## Job queue and worker

A minimal database-backed queue: the `jobs` table plus a long-running worker process
(`worker/index.ts`, run with `tsx`). The sibling pulse-analytics triggers its job via a cron-hit
route; importline does not, because an apply over 500k rows runs for minutes, must heartbeat,
and must survive web-process deploys (see docs/memory.md decisions).

- **Enqueue**: only the state-machine transition helpers insert `jobs` rows (`validate`|`apply`,
  `queued`, `run_after` now), so an import can never have two live jobs.
- **Claim**: poll every 2 s (5 s idle): `findFirst` queued job with `run_after <= now` by id,
  then compare-and-set
  `updateMany({where: {id, state: 'queued'}, data: {state: 'running', locked_by, heartbeat_at}})`.
  Row count 1 means claimed; 0 means another worker won. Atomic on SQLite and Postgres.
- **Heartbeat**: `jobs.heartbeat_at` (and any held `catalog_locks.heartbeat_at`) every 10 s.
- **Janitor** (in the poll loop): a `running` job with heartbeat older than 60 s is reclaimed to
  `queued`, `attempts + 1`; after 5 reclaims the job is `failed` and its import paused with
  `pause_reason = 'job_crash_loop'`. Orphan temp uploads older than 24 h are deleted.
- **Job outcomes**: jobs are transport; imports are truth. A job ends `done` even when its work
  concluded by pausing or cancelling; `failed` always leaves the import `paused` or `failed`
  with a reason. One worker is the default; multiple are safe (atomic claim + catalog lock).

## Exactly-once batch application

The hard invariant: **for every (import_id, batch_number), the product writes of that batch
become visible at most once**, no matter how often the batch is attempted. Mechanism:

1. All writes of a batch happen in one transaction: the `import_batches` ledger row is inserted
   **first**, then product upserts, `import_changes` audit rows, and the `imports` counters.
   The unique `(import_id, batch_number)` makes a second application of a committed batch abort
   on its very first statement, before any product write.
2. Retries are at-least-once; the ledger dedupes them to exactly-once in effect. A crash after
   commit loses nothing: everything the batch did committed atomically with the ledger row.
3. Resume (after pause, cancel, or crash) reads the ledger: skip parsed records through
   `last_row` of the highest committed batch, continue with the next batch number.
4. Batch composition is deterministic: batches are valid rows in file order, and validity is a
   pure function of (file bytes, mapping, normalization rules), so re-streaming on resume
   reproduces the same boundaries; the stored file is immutable (`file_sha256` re-verified).

## Normalization rules

Applied identically in validation and apply (same code path, `lib/normalize/`). All stored text
is UTF-8, NFC-normalized.

**Encoding detection** (first 64 KB): BOM wins (`EF BB BF` utf-8, `FF FE` utf-16le, `FE FF`
utf-16be; BOM stripped); otherwise strict UTF-8 decode of the sample (`TextDecoder`,
`fatal: true`); on failure, `windows-1252`, which maps all 256 byte values and cannot fail. The
full-file decode at parse time uses the detected label with `fatal: false`; invalid sequences
later in a UTF-8 file decode to U+FFFD and the row gets an `encoding_replacement` warning.

**Delimiter detection**: candidates comma, semicolon, tab, pipe, in that precedence order. Parse
the decoded sample (minus any trailing partial record) with each candidate, preview 50 records;
score = records having the modal column count, qualifying only if that count is at least 2.
Highest score wins; ties break by precedence; no qualifier means comma plus `delimiter_uncertain`.

**Text fields** (name, sku, category, description, image_url): decode, NFC-normalize, strip
C0/C1 controls except tab, trim. Caps: sku 64, name 256, category 128, description 8192,
image_url 2048; over cap is `field_too_long` (row rejected, never silently truncated). image_url
must be an absolute http/https URL (`url_invalid`); SKU comparison is byte-exact after
normalization (case-sensitive); empty optionals become null.

**Numbers** (price, stock): trim; strip U+00A0/U+202F between digits; strip one leading or
trailing currency marker (`$`, euro sign U+20AC, pound sign U+00A3, or a three-letter ISO code)
with adjoining whitespace; a leading minus is detected first so the negative codes are precise.
Only digits, `.` and `,` may then remain, else `price_invalid`/`stock_invalid`. Separators:

- Both `.` and `,`: the rightmost occurrence is the decimal separator; all occurrences of the
  other are thousands separators and removed; a repeated decimal separator is invalid.
- One separator, multiple occurrences: thousands; digit groups between occurrences must be
  exactly 3, else invalid.
- One separator, once, exactly 3 digits after it: thousands (`1,234` is 1234). Lossless in
  practice: the rival "three decimals" reading is rejected by `price_precision` anyway.
- One separator, once, otherwise: decimal.

Price: max 2 decimals (`price_precision`), non-negative (`price_negative`), stored as integer
minor units `price_cents`, max 9,999,999,999 cents (`price_out_of_range`). Stock: integer only
(`stock_invalid`), non-negative (`stock_negative`), max 1,000,000,000 (`stock_out_of_range`).

**Row rules**: cell count must match the header (`columns_mismatch`); sku, name, and price are
required (`missing_required` names the column); stock empty or unmapped defaults to 0 on create,
untouched on update; a SKU seen earlier in the file gets a `duplicate_sku` warning (row still
applies; last occurrence wins in file order).

**Row content hash**: sha256 hex over the UTF-8 serialization of the mapped target fields,
sorted by field name, as `field=<normalized value or (null)>` joined with byte 0x1F; price as
cents, stock as integer. The hash covers only mapped fields: identical file + identical mapping
means identical hashes (the zero-change re-import); a mapping change deliberately re-applies.

**Upsert semantics** (per row, inside the batch transaction): look up `(catalog_id, sku)`.
Missing: create with mapped fields, defaults elsewhere, `row_hash`, `last_import_id`. Equal
`row_hash`: skip, no write, counted only. Different hash: update mapped fields only (unmapped
untouched), overwrite `row_hash` and `last_import_id`; the audit row records old and new per
changed field.

## Concurrency: catalog lock

Only one import may apply to a catalog at a time. `catalog_locks` uses `catalog_id` as its
primary key; acquisition is an INSERT that succeeds or hits the PK constraint, portable across
SQLite and Postgres (native advisory locks are not). The apply job acquires the lock first; if
it is held with a fresh heartbeat, the worker pauses the import with `catalog_locked` (no wait
loops; the apply endpoint pre-checks and 409s in the common case). A lock with heartbeat older
than 120 s whose holder job is not `running` is taken over via conditional delete-then-insert.
The lock is released on every exit: completed, paused, cancelled, failed.

## Memory-bounded streaming

The 500k-row ceiling must never translate into 500k rows in memory:

- Upload: request body streams to a temp file; only a hash context and byte counter are held.
- Parse: Node read stream -> decode TransformStream -> papaparse in chunk mode with
  pause/resume backpressure. At most one batch (1000 normalized rows) is buffered.
- Validation writes row errors in chunks of 500 (`createMany`) and queries existing SKUs per
  1000-row chunk in sub-batches of 500 parameters (SQLite's default variable cap is 999).
- The one deliberate exception: duplicate-SKU detection and dry-run simulation keep an
  in-memory map of file SKU -> hash, bounded by the row cap at roughly 80 MB worst case,
  within the worker's 512 MB budget; measured in tests.

## Failure modes

| Failure | Detection | Handling |
|---|---|---|
| Upload aborted, web process dies mid-upload, or size cap hit | Stream error, orphan temp file, or byte counter | 413 for the cap; temp deleted immediately or swept by the janitor after 24 h; no imports row |
| Row count exceeds 500,000 | Counter in validation | Import `failed`, reason `row_limit_exceeded` |
| Stored file missing or hash mismatch at job start | fs open / sha256 check | Import `failed`, reason `file_missing`; lock released if held |
| Invalid bytes mid-file (UTF-8) | U+FFFD after lenient decode | `encoding_replacement` warning on the row; import continues |
| Bad row (validation rule) | Validation pass | Row recorded in report, excluded from batches; import continues |
| Batch transaction fails | Exception in apply | Retry same batch, delay `min(5 * 2^(n-1), 60)` s, up to BATCH_MAX_ATTEMPTS; then `paused` with `failing_batch` + last error |
| Worker crash mid-batch | Stale job heartbeat (> 60 s) | DB rolls the transaction back; janitor requeues; resume from ledger re-applies the batch exactly once |
| Worker crash loop | 5 reclaims of one job | Job `failed`, import `paused`, reason `job_crash_loop` |
| Two applies to one catalog | Lock row exists, fresh heartbeat | Second import `paused`, reason `catalog_locked`; resumable |
| Stale lock (holder dead) | Heartbeat > 120 s, holder job not running | Takeover by conditional delete-then-insert |
| Double-click apply / racing transitions | Conditional update returns 0 rows | 409 `state_conflict`; no second job enqueued |
| Cancel during apply | `cancel_requested` read between batches | In-flight batch commits or rolls back whole; then `cancelled`, lock released |
| SQLite writer contention (web vs worker) | SQLITE_BUSY | WAL mode + busy_timeout 5000 ms on every connection; residual failures fall into batch retry |
| Catalog changed between validation and apply | Not detected | Dry-run counts are advisory; apply recomputes create/update/skip per row inside each batch transaction |

## Correctness invariants

1. A batch's ledger row, product writes, audit rows, and `imports` counters commit atomically;
   the ledger insert is the transaction's first statement.
2. `(import_id, batch_number)` is unique; with at-least-once retries this yields exactly-once.
3. Batch composition is a pure function of (file bytes, mapping, normalization rules); the
   stored file is immutable and verified by `file_sha256`.
4. State transitions happen only through conditional updates; at most one live job per import.
5. At most one import holds a catalog's lock; takeover requires a stale heartbeat plus a
   non-running holder job.
6. Cancellation and pause never interrupt a batch transaction; they act between batches.
7. Products are written only by the apply engine, keeping `row_hash` a sound skip test.
8. Identical file + identical mapping re-imported: zero creates, zero updates, all skips.

## Where state lives

- **Database (single source of truth)** - catalogs, products, imports, ledger, report rows,
  audit, templates, jobs, locks. One backup covers everything except the CSV files.
- **Filesystem (`IMPORTLINE_DATA_DIR`)** - uploaded CSVs, named `<import id>-<sha256 prefix>.csv`
  by the server. Files are immutable inputs; losing one fails its import cleanly.
- **Worker memory** - the current batch buffer and the validation SKU map; bounded and
  reconstructible; a worker restart loses nothing durable.
- **Browser** - no client state beyond the current page; progress comes from polling.

## Proposed folder / file tree

```
importline/
  app/
    layout.tsx  globals.css  page.tsx     page.tsx redirects to /imports
    imports/page.tsx                      history; new/page.tsx upload form
    imports/[id]/page.tsx                 detail: status, dry run, report, audit, actions
    imports/[id]/mapping/page.tsx         mapping screen with template pre-fill
    products/page.tsx  templates/page.tsx catalog browse; saved templates
    api/                                  one route.ts per endpoint in docs/api-contracts.md:
      imports/  imports/[id]/             list+upload; detail
      imports/[id]/{status,preview,mapping,apply,cancel,resume,changes,errors,errors/csv}/
      catalogs/  templates/  templates/[id]/  products/
  worker/
    index.ts                              poll loop, claim, heartbeat, janitor
    validate.ts  apply.ts                 the two job bodies
  lib/
    db.ts  env.ts  logger.ts  errors.ts   Prisma singleton, validated env, JSON log, envelope
    csv/detect.ts  csv/stream.ts          detection; decode + papaparse with backpressure
    normalize/text.ts  number.ts  url.ts  the rules in this document, table-tested
    import/mapping.ts  validateRow.ts     mapping validation + header signature; row rules
    import/hash.ts  batches.ts            row content hash; batch planning and resume math
    import/lock.ts  queue.ts              catalog lock ops; enqueue/claim/heartbeat/janitor
    import/status.ts                      the state machine; the only transition authority
  components/                             upload form, mapping table, progress bar, badges,
                                          report table, audit table, ui/*
  prisma/schema.prisma  prisma/migrations/  committed migrations, never edited after apply
  tests/unit/  integration/  e2e/         see docs/testing.md
  docs/  .env.example  package.json  tsconfig.json  next.config.ts  tailwind.config.ts
  vitest.config.ts  playwright.config.ts  eslint.config.mjs  .prettierrc
```

## Tech stack with rationale

Major versions; exact versions are pinned at install time and `package-lock.json` is committed.

- **Next.js 15 (App Router) + TypeScript 5 (strict)** - portfolio convention (pulse-analytics,
  woo-headless). One deployable serves UI and API; route handlers support request-body
  streaming for the upload path.
- **Prisma 6 + SQLite default, PostgreSQL supported** - the engine's correctness rests on
  transactions and unique constraints, which Prisma exposes identically over both engines.
  SQLite keeps the default deployment to one process pair and one file (WAL + busy_timeout
  handle the web/worker writer overlap at this scale); Postgres is the option for heavier
  concurrency. Chosen over Drizzle (used in pulse-analytics) because this project has no
  hand-written aggregation SQL - its queries are CRUD plus transactions (see docs/memory.md).
- **papaparse 5** - battle-tested streaming CSV parsing: quoted fields, embedded newlines,
  chunked input with pause/resume, exactly what the memory budget requires. Encoding is handled
  before papaparse by Node's `TextDecoder` (WHATWG labels cover all four detected encodings; no
  iconv dependency).
- **tsx worker** - `npx tsx worker/index.ts` runs the TypeScript worker with the same `lib/`
  code and Prisma client as the web app; no second build pipeline.
- **Tailwind CSS 3.4** - portfolio convention; tokens from docs/design.md.
- **Vitest + Playwright, ESLint + Prettier** - as in the sibling projects; integration tests run
  against a real temp SQLite file, plus Postgres in CI; one Playwright smoke.
- **No other runtime dependencies.** Hashing is `node:crypto`; validation is hand-rolled and
  table-tested (no zod); no UI component library.

## Data model

Defined in `prisma/schema.prisma`; every change ships as a committed migration. Names below are
the contract; the coding agent must not rename them. Timestamps are UTC datetimes; `created_at`/
`updated_at` exist on every table and are omitted below; columns are NOT NULL unless marked
NULL; PKs are autoincrement ints unless stated.

```
catalogs ( id PK,  name varchar(128) UNIQUE )     -- a "default" catalog is seeded

products (
  id PK,  catalog_id FK -> catalogs.id,  sku varchar(64),  name varchar(256),
  price_cents int,  stock int DEFAULT 0,  category varchar(128) NULL,
  description text NULL,  image_url varchar(2048) NULL,  -- <= 8192 chars; URL stored as-is
  row_hash char(64),                                     -- sha256 of last applied mapped values
  last_import_id int NULL FK -> imports.id
)
UNIQUE (catalog_id, sku)  -- upsert key; INDEX (catalog_id, updated_at); INDEX (last_import_id)

imports (
  id PK,  catalog_id FK -> catalogs.id,  source_label varchar(128) NULL,
  original_filename varchar(255),  stored_path varchar(512),  -- filename display-only, never a path
  file_size_bytes int,  file_sha256 char(64),                 -- immutability check at job start
  delimiter char(1),  delimiter_uncertain boolean DEFAULT false,
  encoding varchar(16),                        -- utf-8|utf-16le|utf-16be|windows-1252
  header_json json,  mapping_json json NULL,   -- ordered raw headers; header -> field, null until mapped
  state varchar(16),  total_rows int NULL,  processed_rows int DEFAULT 0,
  error_rows int DEFAULT 0,  warning_rows int DEFAULT 0,
  would_create int NULL,  would_update int NULL,  would_skip int NULL,      -- dry run
  created_count int DEFAULT 0,  updated_count int DEFAULT 0,  skipped_count int DEFAULT 0,
  batch_size int,  last_committed_batch int DEFAULT 0,  -- snapshot; denormalized in same tx as ledger
  failing_batch int NULL,  pause_reason varchar(32) NULL,  -- batch_failed|catalog_locked|job_crash_loop
  cancel_requested boolean DEFAULT false,  started_at datetime NULL,  finished_at datetime NULL
)
INDEX (catalog_id, created_at); INDEX (state)

import_batches (                                  -- the ledger
  id PK,  import_id FK -> imports.id CASCADE,  batch_number int,       -- 1-based, contiguous
  first_row int,  last_row int,                                        -- record numbers (header = 1)
  created_count int,  updated_count int,  skipped_count int,  applied_at datetime )
UNIQUE (import_id, batch_number)  -- the exactly-once guarantee

import_row_errors (
  id PK,  import_id FK -> imports.id CASCADE,
  phase varchar(8),  row_number int,               -- validate|apply; CSV record number, header = 1
  column_name varchar(256) NULL,  code varchar(64),   -- codes: docs/api-contracts.md
  severity varchar(8),  message varchar(512)       -- error|warning; value excerpts capped at 64 chars
)
INDEX (import_id, row_number); INDEX (import_id, severity)
-- re-validation deletes the import's previous validate-phase rows first

import_changes (                                  -- audit
  id PK,  import_id FK -> imports.id CASCADE,  batch_number int,  sku varchar(64),
  action varchar(8),                              -- create|update (skips counted, not stored)
  fields_json json                                -- create: values; update: {field: [old, new]}
)
INDEX (import_id, id); INDEX (import_id, sku)

mapping_templates (
  id PK,  name varchar(128) UNIQUE,  mapping_json json,  last_used_at datetime NULL,
  header_signature char(64)                       -- sha256 of ordered NFC-trimmed headers
)
INDEX (header_signature)          -- pre-fill lookup on upload

jobs (
  id PK,  type varchar(16),  import_id FK -> imports.id,   -- type: validate|apply
  state varchar(8),  attempts int DEFAULT 0,     -- queued|running|done|failed; reclaim counter
  run_after datetime,  locked_by varchar(64) NULL,          -- worker id: hostname + pid + random
  heartbeat_at datetime NULL,  last_error varchar(512) NULL )
INDEX (state, run_after)          -- the claim query

catalog_locks (                                   -- one lock per catalog by construction
  catalog_id int PK FK -> catalogs.id,  import_id FK -> imports.id,
  worker_id varchar(64),  acquired_at datetime,  heartbeat_at datetime
)
```

## External dependencies and required env vars

External runtime services: none by default (SQLite); optionally a PostgreSQL 14+ server via
`DATABASE_URL`. Two processes make a deployment: `next start` and the worker under a supervisor.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `file:./data/importline.db` (default) or a `postgresql://` URL |
| `IMPORTLINE_DATA_DIR` | Directory for uploaded CSVs (default `./data/uploads`) |
| `IMPORT_MAX_FILE_MB` | Upload size cap in MB (default 200); larger uploads get 413 |
| `IMPORT_BATCH_SIZE` | Rows per apply batch (default 1000) |
| `BATCH_MAX_ATTEMPTS` | Attempts per batch before pausing (default 3) |

All env access goes through `lib/env.ts`, which validates at startup and fails fast. Worker
timing constants (poll interval, heartbeat 10 s, stale job 60 s, stale lock 120 s, reclaim cap
5, row cap 500,000) live in code, not config, per the YAGNI rule in docs/rules.md.
