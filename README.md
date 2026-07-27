# importline

A self-hosted, resumable bulk import engine for product catalogs. Upload a supplier CSV of up to
500,000 rows, map its columns to your product fields, validate every row with a downloadable
report, preview exactly what an import would create, update, and skip, then apply it in
transactional 1000-row batches that are recorded in a ledger so a batch can never run twice. A
crashed, paused, or cancelled import resumes from the last committed batch, and re-importing an
identical file changes nothing.

## The problem

Loading supplier CSVs into a catalog is quietly dangerous. Files arrive with mystery delimiters
and encodings, half-broken rows, and formats that change between months. Naive importers read the
whole file into memory, die halfway leaving the catalog in an unknown state, double-apply rows on
retry, and give no account of what actually changed. importline treats the import as an
engineering problem: streamed parsing with bounded memory, precise normalization rules, a
validation pass with dry-run counts before anything is written, exactly-once batch application
backed by a database ledger, safe cancellation, and a full per-import audit trail.

## Planned features

All of the following is planned behavior; implementation has not started (see Status).

- Streamed CSV upload (up to 500k rows) with automatic delimiter and encoding detection,
  operator-overridable.
- Column mapping UI for the target fields (name, sku, price, stock, category, description,
  image url) with saved mapping templates matched by header signature.
- Validation pass producing a row-level report (error code, row number, column, message),
  browsable and downloadable as CSV.
- Dry-run counts: would-create, would-update, would-skip, before committing anything.
- Chunked apply: 1000-row batches, one transaction per batch, batch ledger with a unique
  constraint for exactly-once application, progress served by a polled status endpoint.
- Idempotent imports: upsert by SKU with a per-row content hash; an identical file re-imported
  with the same mapping results in zero changes.
- Resumability: paused, cancelled, or crashed imports continue from the last committed batch.
- Partial-failure semantics: bad rows are skipped and reported, failed batches retry with
  backoff, three consecutive failures pause the import with the reason recorded.
- Concurrency safety: a database-backed advisory lock allows one applying import per catalog.
- Import history with per-import stats and a full audit of created and changed products.

Out of scope by design: Excel parsing, image downloading, exports, and multi-user permissions.

## Stack

- Next.js 15 (App Router) + TypeScript 5, Tailwind CSS
- Prisma ORM; SQLite by default, PostgreSQL supported via `DATABASE_URL`
- Database-backed job queue processed by a separate worker process (tsx)
- papaparse for streaming CSV parsing
- Vitest (unit + integration) and a Playwright smoke test

## Documentation

| Document | Contents |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Problem, target user, core features, non-goals, success criteria |
| [docs/architecture.md](docs/architecture.md) | Stack rationale, data model, flows, failure modes, invariants |
| [docs/rules.md](docs/rules.md) | Project-specific engineering rules |
| [docs/phases.md](docs/phases.md) | Implementation phases with commit lists and verification checklists |
| [docs/design.md](docs/design.md) | Screens, layout, states, accessibility baseline |
| [docs/testing.md](docs/testing.md) | Test strategy, coverage split, commands, CI plan |
| [docs/api-contracts.md](docs/api-contracts.md) | Every endpoint with examples and the error envelope |
| [docs/launch-checklist.md](docs/launch-checklist.md) | Pre-launch verification |
| [docs/memory.md](docs/memory.md) | Working log and decisions |

## Status

Planning stage: the documents above are complete and under review; no application code exists
yet. Implementation follows docs/phases.md one approved phase at a time.
