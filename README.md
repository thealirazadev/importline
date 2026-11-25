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

## Features

Implemented:

- Streamed CSV upload with a size cap enforced while streaming, and automatic delimiter and
  encoding detection that the operator can override.
- Column mapping for the target fields (name, sku, price, stock, category, description, image
  url), with saved mapping templates matched by header signature.
- A validation pass run by a separate worker process, producing a row-level report (error code,
  row number, column, message) that is browsable and downloadable as CSV.
- Dry-run counts: would-create, would-update and would-skip against the current catalog, before
  anything is written.
- Progress served by a polled status endpoint, and import history.

Designed but not implemented yet (see `docs/architecture.md`):

- Chunked apply in 1000-row batches, one transaction per batch, recorded in a batch ledger with a
  unique constraint so a batch is never applied twice.
- Idempotent upserts by SKU using the per-row content hash the validation pass already computes.
- Resume of paused, cancelled or crashed imports from the last committed batch, batch retries with
  backoff, and a per-catalog lock so two imports never write the same catalog at once.
- A per-import audit of created and changed products.

Out of scope by design: Excel parsing, image downloading, exports, and multi-user permissions.

## Stack

- Next.js 15 (App Router) + TypeScript 5, Tailwind CSS
- Prisma ORM; SQLite by default, PostgreSQL supported via `DATABASE_URL`
- Database-backed job queue processed by a separate worker process (tsx)
- papaparse for streaming CSV parsing
- Vitest (unit + integration)

## Documentation

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Stack rationale, data model, flows, failure modes, invariants |
| [docs/design.md](docs/design.md) | Screens, layout, states, accessibility baseline |
| [docs/api-contracts.md](docs/api-contracts.md) | Every endpoint with examples and the error envelope |
| [docs/testing.md](docs/testing.md) | Test strategy, commands, and what CI runs |
| [docs/decisions.md](docs/decisions.md) | Design decisions and the reasons behind them |

## Running locally

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run seed      # default catalog
npm run dev       # web
npm run worker    # in a second terminal: runs validation jobs
```

## Status

Upload, detection, mapping, validation, the dry run and the report work end to end. The apply
engine (batches, ledger, resume, catalog lock, audit) is the remaining work. importline has no
authentication and is meant for localhost or a trusted network.
