# Testing - importline

## Strategy

- **Automated first, manual second.** Every feature ships with tests in the same commit series;
  the verification checklists in docs/phases.md cover what automation observes poorly (real
  SIGKILL of the worker, browser keyboard passes, README dry runs).
- **Vitest for unit and integration, Playwright for one smoke.** Unit tests isolate pure logic;
  integration tests run the real pipeline (upload handling, jobs, transactions) against a real
  temp SQLite file per test (not `:memory:`, because web and worker semantics depend on a shared
  file with WAL), and against PostgreSQL in a CI job. The worker's job functions are invoked
  in-process; the poll loop itself is covered by the claim/heartbeat tests plus one spawn test.
- **Fixtures over generators for edges, generators for scale.** Small hand-written CSV fixtures
  pin every documented error code and normalization edge; a fixture generator produces the
  10,000 and 500,000-row files (the latter only in the scheduled/soak job, not on every push).
- **No network anywhere.** Nothing in the product calls out; tests must not either.

## What gets unit coverage (Vitest, pure)

- `lib/normalize/*`: table-driven cases mirroring the architecture rules - both-separator
  prices, repeated separators, the single-separator 3-digit thousands case, U+00A0/U+202F,
  currency markers and ISO codes, negatives, precision, ranges; text trimming/NFC/control
  stripping and every length cap; url validation.
- `lib/csv/detect.ts`: BOM variants, strict-UTF-8 pass/fail samples, windows-1252 fallback;
  delimiter scoring per candidate including the no-qualifier `delimiter_uncertain` path.
- `lib/import/hash.ts`: stable across value-equivalent formatting; changes with mapped-field
  set; field-order independence.
- `lib/import/mapping.ts`: required-field enforcement, unknown header/field rejection, header
  signature stability.
- `lib/import/batches.ts`: batch boundary math, resume-skip math from a ledger state.
- `lib/errors.ts` envelope shape; report CSV cell prefixing (`=`, `+`, `-`, `@`).

## What gets integration coverage (Vitest, real DB + files)

- Upload: streaming cap (413, temp cleanup), atomic rename, sha256 correctness, detection on
  real files in all four delimiters and three encodings.
- Queue: two claimants, one winner; heartbeat; janitor reclaim; crash-loop cap pausing the
  import; orphan temp sweep.
- Validation: full report for the kitchen-sink fixture; dry-run counts against a seeded
  catalog; re-validation idempotency; row cap; cancellation at a chunk boundary; RSS ceiling on
  the large fixture (soak job).
- Apply: exactly-once (forced duplicate batch application aborts before any product write);
  ledger/counters/audit committed atomically (crash injection between statements must roll back
  everything); hash-skip on identical re-import with `updated_at` untouched; unmapped fields
  preserved on update; batch retry schedule and pause after 3; lock contention (second import
  paused `catalog_locked`); stale lock takeover; SIGKILL resume equals uninterrupted final state.
- API: every endpoint's success and error shapes against docs/api-contracts.md, including 409
  state conflicts from racing conditional transitions.

## What gets e2e coverage (Playwright)

One smoke, kept deliberately thin: upload a 50-row fixture, complete mapping with a saved
template, watch validation finish, apply, see completed stats, find an imported product on the
products page. Runs headless in CI; anything deeper belongs in integration.

## Exact commands

```bash
npm test                  # vitest run: unit + integration (temp sqlite)
npm run test:unit         # vitest run tests/unit
npm run test:integration  # vitest run tests/integration
npm run test:e2e          # playwright test (needs a built app; script boots web + worker)
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
npm run worker            # npx tsx worker/index.ts
```

## CI plan (GitHub Actions)

- On push and PR to `main`: lint, typecheck, unit + integration on SQLite, build, integration
  on PostgreSQL (service container), Playwright smoke against the production build with a real
  worker process.
- A scheduled weekly soak job runs the 500,000-row validate + apply with an RSS assertion
  (< 512 MB worker) and a wall-clock budget, so memory regressions surface without slowing
  every push.

## Definition of "done" for a feature

1. `npm run lint` and `npm run typecheck` clean.
2. `npm test` green, new tests included.
3. The feature's items in the current phase's verification checklist pass.
