# Engineering Rules - importline

These rules extend the workspace-level engineering conventions and are binding for every change
in this repository.

## Conventions

- **Layering**: route handlers stay thin - parse input, call `lib/`, shape the envelope. All
  import logic lives in `lib/csv`, `lib/normalize`, and `lib/import`; the worker jobs in
  `worker/` orchestrate those same modules. No Prisma queries in components or route handlers
  beyond trivial single-row reads; anything with a transaction lives in `lib/import`.
- **One transition authority**: `lib/import/status.ts` owns every import state change as a
  conditional update. No route, job, or component sets `imports.state` any other way. Job
  enqueue happens inside the transition helpers so an import can never hold two live jobs.
- **Shared normalization**: validation and apply call the exact same `lib/normalize` and
  `lib/import/validateRow.ts` functions. Never duplicate a rule; batch determinism depends on it.
- **Streaming discipline**: no code path may read an uploaded file fully into memory
  (`fs.readFile` on an upload is a defect). Parsing goes through `lib/csv/stream.ts` with
  backpressure; buffers are bounded by one batch. The only sanctioned unbounded-in-rows
  structure is the validation SKU map, documented in docs/architecture.md.
- **TypeScript strict**: `strict: true`, no `any` (use `unknown` and narrow), no non-null
  assertions outside tests, exhaustive switches over unions (state, error codes) enforced with a
  `never` check. Server-only modules (`lib/db.ts`, `lib/env.ts`) must not be importable from
  client components (`server-only` import guard).
- **Naming**: route folders lowercase; components PascalCase; lib modules camelCase; database
  tables plural snake_case and columns snake_case exactly as in docs/architecture.md (Prisma
  `@@map`/`@map` where needed). Stable identifiers (error codes, states, pause reasons, log
  keys) are lowercase snake_case string literals collected in one module each.
- **Commit format**: Conventional Commits, short imperative subject, e.g.
  `feat: add batch ledger and transactional batch apply`. One commit per feature or task; the
  commit lists in docs/phases.md are the intended order. No AI or tooling attribution anywhere.
- **Pinned dependencies**: exact versions in `package.json`, `package-lock.json` committed. Any
  dependency change is its own commit and needs owner approval first.
- **Migrations**: every schema change is a Prisma migration; never edit an applied migration;
  never `db push` against a shared database. Schema and migration ship in the same commit.
- **Engine portability**: no raw SQL unless unavoidable, and never engine-specific SQL; the same
  code must run on SQLite and PostgreSQL. Parameterized `IN` lists stay under 500 items (SQLite
  variable cap). Date math happens in TypeScript, not SQL.

## Error handling & logging

- **Every fallible call handles failure**: file I/O (open, stream, rename, unlink), every
  transaction, job claim, and lock operation. A worker job wraps its body so an unexpected throw
  records `jobs.last_error` and leaves the import in a documented state - never a silently stuck
  `running` row (the janitor is a backstop, not the plan).
- **One error envelope**: every API error is
  `{ "error": { "code": "...", "message": "...", "details": {...}? } }` per
  docs/api-contracts.md. No route invents its own shape; `lib/errors.ts` is the only constructor.
- **Friendly vs detailed**: API messages are short and safe; full context (import id, batch
  number, attempt, exception message) goes to structured logs. Never a stack trace in a
  response; never raw cell values in logs (they can hold anything), only value excerpts capped
  at 64 chars in report messages.
- **Structured logging from day one**: one JSON line per event via `lib/logger.ts` with dotted
  keys: `import.uploaded`, `import.detected`, `mapping.saved`, `validate.started`,
  `validate.completed`, `validate.failed`, `apply.started`, `batch.applied`, `batch.retry`,
  `batch.failed`, `import.paused`, `import.resumed`, `import.cancelled`, `import.completed`,
  `import.failed`, `lock.acquired`, `lock.released`, `lock.takeover`, `job.claimed`,
  `job.reclaimed`, `worker.started`. Every entry carries `import_id` where one exists.
- **Row problems are data, not logs**: validation findings go to `import_row_errors`, not the
  log stream; 100,000 bad rows must not produce 100,000 log lines. Logs record the pass and its
  counts.

## Security

- **No secrets in the repo**: config via `.env` (git-ignored); `.env.example` carries dummies.
  v1 has no auth by design (trusted network; see PRD non-goals) - do not add ad hoc auth
  without owner approval, and keep the reverse-proxy note in the launch checklist honest.
- **Paths are server-generated**: uploaded files are stored under `IMPORTLINE_DATA_DIR` with
  server-generated names; `original_filename` is display-only and never joined into a path.
  Reject path separators and null bytes in any operator-entered string.
- **Validate all input server-side**: mapping payloads (known headers, known target fields,
  required fields present), pagination params (bounded per_page), catalog and template names
  (length caps). Never trust the client's row counts or states.
- **CSV injection**: the report CSV download prefixes any cell starting with `=`, `+`, `-`, or
  `@` with a single quote, because report messages can echo attacker-controlled cell content and
  the file is destined for spreadsheet software.
- **Rendered cell content is escaped**: report messages, product values, and audit diffs render
  through React's default escaping only; no `dangerouslySetInnerHTML` anywhere.
- **Queries**: Prisma parameter binding only; no string-built SQL.
- **Uploads**: size cap enforced while streaming (not after); content is treated as opaque CSV
  text; no file is ever executed, served back raw, or fetched from (image urls are stored, never
  requested).

## Simplicity / YAGNI-KISS

- Build only what the current phase requires. Config stays at the five documented env values;
  worker timing constants live in code.
- No abstraction until three real use cases exist. No repositories, no service classes, no
  event emitters; plain functions in `lib/`.
- Prefer boring: polling over websockets, conditional updates over distributed-lock libraries,
  one queue table over a queue dependency.
- If a solution exceeds roughly 150 lines, pause and justify it before continuing.

## Boundaries - never do without asking the owner first

- No wholesale delete/rewrite of working files; targeted edits, destructive changes flagged.
- Do not change docs/PRD.md or docs/architecture.md without flagging the change and its reason.
- No new dependency without approval (what, why, version, size).
- Stop after two failed fix attempts on the same problem and report instead of thrashing.
- Any mid-phase request not in the PRD gets classified with the owner as current phase, new
  phase, or Backlog in docs/phases.md. Never silently absorb scope.
