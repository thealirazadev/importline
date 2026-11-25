# Testing - importline

## Strategy

- **Automated first, manual second.** Every feature ships with tests. Manual checks cover what
  automation observes poorly: a real worker process killed mid-job, browser keyboard passes, and
  memory use while uploading and validating very large files.
- **Vitest for unit and integration.** Unit tests isolate pure logic. Integration tests run the
  real pipeline (upload handling, the job queue, the validation job, the report) against a real
  temp SQLite file per test file, not `:memory:`, because web and worker semantics depend on a
  shared file with WAL. Each integration setup runs `prisma migrate deploy` into its temp
  directory, so the real migration is exercised. The worker's job functions are invoked
  in-process; the poll loop itself is not started by tests.
- **Small fixtures for edges.** Hand-written CSV fixtures pin each documented error code and
  normalization edge.
- **No network anywhere.** Nothing in the product calls out; tests must not either.

## What is covered

Unit (`tests/unit`):

- `lib/normalize/*`: text NFC, trimming, control stripping and length caps; price decimals,
  thousands separators, the single-separator three-digit thousands case, currency markers and
  negatives; stock integers, `.00` decimals, fractional and negative stock; url validation.
- Row validation: a good row, a missing sku, a column-count mismatch, and the content hash.
- `lib/csv/detect.ts`: BOM precedence, strict UTF-8, the Windows-1252 fallback, a multi-byte
  sequence cut by the sample boundary, every delimiter candidate, the uncertain path, tie-breaking
  by precedence, and header normalization.
- `lib/csv/cell.ts`: formula neutralization when a cell also needs quoting, and plain quoting.
- `lib/env.ts`: defaults, trimming, a non-SQLite `DATABASE_URL` rejected at startup, and every
  problem listed in one error.

Integration (`tests/integration`):

- Upload: the file is streamed to disk, hashed and recorded; an upload over the cap returns 413 and
  leaves no row and no temp file; non-multipart requests and unknown catalogs are rejected.
- Queue: exactly one of two workers claims a job; only the holding worker can heartbeat; a stale
  running job is reclaimed; orphan temp uploads older than a day are swept.
- Validation: a mapping without price is rejected with the field named; a messy file validated
  through the worker job reports every documented code at its spreadsheet row; the CSV report has
  the documented columns; a second upload with the same headers is pre-filled from the saved
  template.

## Exact commands

```bash
npm test                  # vitest run: unit + integration (temp sqlite)
npm run test:unit         # vitest run tests/unit
npm run test:integration  # vitest run tests/integration
npm run lint              # eslint + prettier check
npm run typecheck         # tsc --noEmit
npm run build             # next build
```

First-time setup:

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run seed              # default catalog
```

Running the full system locally (two processes):

```bash
npm run dev               # web (next dev)
npm run worker            # tsx worker/index.ts
```

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main`, on Node 22, after
`npm ci`:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test:unit`
4. `npm run build`

CI runs the unit suite only, so run `npm run test:integration` (or `npm test`) locally before
opening a pull request.

## Definition of "done" for a feature

1. `npm run lint` and `npm run typecheck` clean.
2. `npm test` green, new tests included.
3. The feature's manual checks pass.
