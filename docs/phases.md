# Phases - importline

**Rule: phase N+1 does not start until the owner approves phase N.** Phases are ordered
smallest-useful-shippable first; each ends green (build clean, tests pass, lint clean, worker and
web run together). One commit per feature/task, Conventional Commits, in the listed order.

The senior differentiators are hard requirements placed early: streaming with bounded memory and
the job queue land in Phase 1; the precise normalization rules and the row-level report land in
Phase 2; the batch ledger with exactly-once apply, the catalog lock, and pause-on-failure land in
Phase 3. None of these may slip to a later phase.

---

## Phase 1 - Foundation, streamed upload, and the worker skeleton

**Goal**: A CSV can be uploaded (streamed, capped, hashed), its delimiter and encoding are
detected, an imports row exists in `uploaded` state, and a separate worker process claims jobs
from the database queue with heartbeats. Smallest slice that proves the two-process shape.

### Definition of done

- Next.js 15 + TypeScript strict scaffold; Tailwind; ESLint + Prettier; Vitest wired;
  `.env.example` with the five documented variables; `lib/env.ts` validates and fails fast.
- Prisma schema and the initial migration create every table in docs/architecture.md exactly
  (names, columns, unique indexes); SQLite connects in WAL mode with busy_timeout 5000 ms;
  a "default" catalog is seeded.
- `POST /api/imports` streams the multipart body to a temp file with a running byte counter and
  sha256, enforces `IMPORT_MAX_FILE_MB` (413, temp deleted), atomically renames into
  `IMPORTLINE_DATA_DIR`, runs detection, and creates the imports row. No full-file reads.
- `lib/csv/detect.ts` implements the BOM/UTF-8/windows-1252 encoding rule and the scored
  delimiter rule from docs/architecture.md, including `delimiter_uncertain`.
- `GET /api/imports` and `GET /api/imports/{id}` return the documented shapes; upload page and
  history page render with an explicit empty state.
- `jobs` queue helpers: enqueue, atomic compare-and-set claim, heartbeat, janitor reclaim of
  stale jobs and deletion of orphan temp uploads. `worker/index.ts` runs the poll loop, logs
  `worker.started` and `job.claimed`, and processes a no-op job type in tests.
- Structured logging live for `import.uploaded`, `import.detected`, `job.claimed`,
  `job.reclaimed`, `worker.started`.

### Verification checklist

- `npm run build`, `npm test`, `npm run lint` all clean; web + worker start together.
- Upload a comma, a semicolon, a tab, and a pipe file: detection correct each time; a UTF-16 LE
  (BOM) file and a Windows-1252 file decode correctly in the stored sample.
- Upload just over the cap: 413 envelope, no file left in the data dir, no imports row.
- Kill the upload mid-stream (curl abort): no imports row; temp file swept by the janitor.
- Two workers + one queued job: exactly one claims it (contention test in CI).
- Kill a worker holding a running job: after 60 s the other worker reclaims it.
- History page with zero imports shows the empty state; RSS of the web process stays flat while
  uploading a 200 MB file.

### Commits

1. `chore: scaffold next app with typescript tailwind and tooling`
2. `chore: add env example and validated env access`
3. `feat: add prisma schema and initial migration`
4. `feat: add db client logger and error envelope`
5. `feat: add catalog seed and catalogs api`
6. `feat: add encoding and delimiter detection`
7. `feat: add streamed csv upload endpoint`
8. `feat: add imports list and detail api`
9. `feat: add job queue with atomic claim and heartbeat`
10. `feat: add worker process with janitor`
11. `feat: add upload and history pages`
12. `test: cover detection upload and job claim`

---

## Phase 2 - Mapping, normalization, and the validation pass

**Goal**: The operator maps headers to product fields (with templates), and a worker job streams
the file through the exact normalization rules, producing the row-level report, dry-run counts,
and a downloadable CSV. The import reaches `validated`.

### Definition of done

- `GET /api/imports/{id}/preview` returns headers and the first 20 parsed rows using the stored
  delimiter/encoding.
- `PUT /api/imports/{id}/mapping` validates the mapping (known headers, known fields, sku/name/
  price mapped), accepts delimiter/encoding overrides, optionally saves a named template, and
  performs the `uploaded|validated -> validating` transition that enqueues the validate job.
- Mapping templates: header signature computed per docs/architecture.md; upload response and
  mapping screen pre-fill from a matching template; list and delete endpoints work.
- `lib/normalize/*` implements the text, price, stock, and url rules exactly as written,
  table-tested including every documented edge (both separators, repeated separators, the
  3-digit thousands case, U+00A0/U+202F, currency markers, negative detection).
- The validate job streams with backpressure, enforces the 500,000-row cap (`failed`,
  `row_limit_exceeded`), writes `import_row_errors` in chunks of 500, detects duplicate SKUs via
  the bounded map, computes would-create/update/skip against the catalog in sub-500-parameter
  SKU queries, deletes prior validate-phase rows on re-run, honors `cancel_requested` at chunk
  boundaries, and finishes the `validating -> validated` transition with counts.
- `GET /api/imports/{id}/errors` paginates with severity/code filters;
  `GET /api/imports/{id}/errors/csv` streams the report with CSV-injection prefixing.
- `GET /api/imports/{id}/status` serves the poll payload; the mapping screen and import detail
  page show validation progress, the report table, and the dry-run summary.
- Logs live for `mapping.saved`, `validate.started`, `validate.completed`, `validate.failed`.

### Verification checklist

- Build, tests, lint clean; the normalization table tests read like the architecture doc.
- A fixture with a bad price, missing sku, short row, oversize field, bad url, and duplicate sku
  produces exactly the documented codes at the right rows; the CSV download matches the API.
- Dry-run counts on a seeded catalog are exact; re-running validation produces identical results
  and no duplicated report rows.
- Remapping a validated import re-validates; a mapping missing price is rejected with field
  errors; a template pre-fills on a second upload with the same headers.
- A 500,001-row file fails fast with `row_limit_exceeded`; a 500,000-row file validates with
  worker RSS under 512 MB (measured in the integration test).
- Cancel during validation lands in `cancelled`; the report written so far remains readable.

### Commits

1. `feat: add import preview api`
2. `feat: add text price stock and url normalization`
3. `feat: add row validation and content hash`
4. `feat: add mapping save endpoint with overrides`
5. `feat: add mapping templates with header signature`
6. `feat: add mapping screen with template prefill`
7. `feat: add streaming validation job with row report`
8. `feat: add dry run counts to validation`
9. `feat: add error report api and csv download`
10. `feat: add status endpoint and progress polling`
11. `test: cover normalization mapping and validation`

---

## Phase 3 - The apply engine: ledger, exactly-once batches, lock, pause

**Goal**: A validated import applies in 1000-row transactional batches recorded in the ledger,
upserting by SKU with hash skips, writing the audit trail, guarded by the catalog lock, retrying
failed batches, and pausing after three strikes. The heart of the product.

### Definition of done

- `POST /api/imports/{id}/apply` performs the conditional `validated -> applying` transition
  (409 `state_conflict` on a lost race), pre-checks the catalog lock (409 `catalog_locked`), and
  enqueues the apply job.
- The apply job acquires the catalog lock (or pauses with `catalog_locked`), verifies
  `file_sha256`, streams the file re-using the validation code path, forms batches of
  `IMPORT_BATCH_SIZE` valid rows, and per batch runs one transaction: ledger insert first
  (unique `(import_id, batch_number)`), then upserts with the hash-skip rule, `import_changes`
  audit rows, and the imports counters/`processed_rows`/`last_committed_batch` update.
- Batch failure retries with `min(5 * 2^(n-1), 60)` s delays up to `BATCH_MAX_ATTEMPTS`, logging
  `batch.retry`; exhaustion pauses the import with `failing_batch`, `pause_reason` and the last
  error recorded; the lock is released on every exit path.
- `GET /api/imports/{id}/changes` paginates the audit; the import detail page shows apply
  progress (polled), final stats, and the audit table.
- Logs live for `apply.started`, `batch.applied`, `batch.retry`, `batch.failed`,
  `import.paused`, `import.completed`, `lock.acquired`, `lock.released`.

### Verification checklist

- Build, tests, lint clean; the exactly-once test forces a duplicate batch application and
  proves the ledger aborts it before any product write.
- A 10,000-row fixture applies in 10 batches; counts match the dry run; audit rows show correct
  old/new values for updates and full values for creates; skipped rows produce no audit rows.
- Re-importing the identical file with the identical mapping: all rows skip, zero writes,
  products' `updated_at` unchanged.
- An injected per-batch failure (test hook) retries on schedule and pauses after 3 attempts with
  the batch number recorded; the lock is released.
- Two imports applying to one catalog: the second pauses with `catalog_locked`.
- Unmapped fields are untouched on update; stock defaults to 0 only on create.

### Commits

1. `feat: add catalog advisory lock`
2. `feat: add apply endpoint with state guard`
3. `feat: add batch ledger and transactional batch apply`
4. `feat: add sku upsert with hash skip`
5. `feat: add change audit records`
6. `feat: add batch retry with pause on exhaustion`
7. `feat: add apply progress and import stats`
8. `feat: add import detail apply and audit ui`
9. `test: cover exactly once apply skip and pause`

---

## Phase 4 - Resume, cancellation, and crash recovery

**Goal**: Every interruption story from the architecture doc holds under test: cancel between
batches, resume from the ledger after pause/cancel/crash, janitor reclaim, stale lock takeover.

### Definition of done

- `POST /api/imports/{id}/cancel` sets `cancel_requested` (applying/validating) or performs the
  direct pre-apply cancel transition; the worker honors the flag between batches and at
  validation chunk boundaries, releases the lock, and logs `import.cancelled`.
- `POST /api/imports/{id}/resume` performs `paused|cancelled -> applying` with a fresh job and
  fresh retry budget; the apply job resumes strictly after `last_committed_batch` using the
  ledger row range, re-verifying `file_sha256` first.
- Janitor reclaim (stale heartbeat > 60 s) requeues jobs; the 5-reclaim cap fails the job and
  pauses the import with `job_crash_loop`; stale lock takeover (heartbeat > 120 s, holder job
  not running) works via conditional delete-then-insert; logs `lock.takeover`.
- Paused/cancelled banners with reasons and resume/cancel actions appear on the detail page;
  history badges cover every state.

### Verification checklist

- Build, tests, lint clean.
- Kill the worker (SIGKILL) mid-apply; restart: the interrupted batch is re-applied exactly
  once, the import completes, and total counts equal an uninterrupted run (integration test
  compares final product table state byte-for-byte).
- Cancel during apply: stops between batches; resume completes; the ledger shows contiguous
  batch numbers with no duplicates.
- Resume after modifying the stored file: the job refuses (`file_missing`/hash mismatch ->
  `failed`), nothing applied.
- A crash-looping job pauses its import after 5 reclaims; a stale lock is taken over and the
  paused-by-lock import resumes cleanly afterward.
- Double-click cancel and resume: single consistent outcome, one live job at most.

### Commits

1. `feat: add cancellation endpoint and worker checks`
2. `feat: add resume from batch ledger`
3. `feat: add stale job reclaim with crash loop cap`
4. `feat: add stale lock takeover`
5. `feat: surface pause cancel and resume in ui`
6. `test: cover resume cancellation and crash recovery`

---

## Phase 5 - Products browse, history polish, Postgres, and e2e

**Goal**: The operator can browse the catalog and full import history; the engine is verified on
PostgreSQL; CI runs the whole pyramid including the Playwright smoke; README finalized.

### Definition of done

- `GET /api/products` with catalog filter, SKU/name search, pagination; products page with
  search and empty states; import history page shows per-import stats and links to report/audit.
- Postgres pass: migrations run, integration suite green against Postgres in CI (service
  container), no engine-specific behavior found (or fixed portably).
- CI workflow: lint, typecheck, unit + integration (SQLite and Postgres jobs), build, Playwright
  smoke (upload -> map -> validate -> apply -> products visible).
- README install/run/test sections replace planning placeholders and match docs/testing.md
  exactly; launch checklist items that can be pre-verified are checked against a local prod
  build.

### Verification checklist

- Build, tests, lint clean on both engines; CI green end to end.
- Playwright smoke passes headless in CI and locally headed.
- Search finds by SKU and name fragments; pagination bounds respected; per_page capped.
- A fresh clone following README alone reaches a completed import (manual dry run of the docs).

### Commits

1. `feat: add products browse api and page`
2. `feat: polish import history and stats`
3. `feat: verify postgres support`
4. `chore: add ci workflow`
5. `test: add playwright smoke flow`
6. `docs: finalize readme`
7. `docs: log phase five completion in memory`

---

## Backlog

_(empty - move out-of-scope ideas here with a one-line rationale)_
