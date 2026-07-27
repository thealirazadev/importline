# Project Memory - importline

Running log of what is done, in progress, and decided. Update after every meaningful chunk of
work; log every non-obvious decision with its reason. Keep entries short and dated.

## Completed

- 2026-07-27 - Planning documentation created (README, PRD, architecture, rules, phases, design,
  testing, api-contracts, launch-checklist, memory). No code yet; docs await owner review before
  Phase 1 starts.

## Project status

- Planning stage. Implementation follows docs/phases.md, one approved phase at a time.

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
