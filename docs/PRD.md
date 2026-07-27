# Product Requirements - importline

## What we're building

A self-hosted, resumable bulk import engine for product catalogs. The operator uploads a CSV of up
to 500,000 rows; the file is streamed to disk, never held fully in memory, and its delimiter and
encoding are detected automatically. A column-mapping screen maps CSV headers to the target product
fields (name, sku, price, stock, category, description, image url), with saved mapping templates
recognized by header signature. A validation pass produces a row-level report (error code, row
number, column, message) downloadable as CSV, plus dry-run counts of what an apply would create,
update, and skip. Applying processes the file in 1000-row batches, one database transaction per
batch, recorded in a batch ledger so a batch is never applied twice. Rows are upserted by SKU with
a per-row content hash, so re-importing an identical file changes nothing. A crashed or cancelled
import resumes from the last committed batch. Import history shows per-import stats and a full
audit of what each import created and changed.

## Target user

A developer or operations person at a small commerce business who receives product catalog CSVs
from suppliers and needs to load them safely and repeatedly: messy delimiters and encodings,
half-broken rows, re-sent files, and multi-hundred-thousand-row catalogs that must not be loaded
twice or halfway. Single operator, self-hosted on a trusted network; not a SaaS.

## Core features (prioritized)

1. **Streamed upload with detection** - CSV up to 500,000 rows and a configurable size cap is
   streamed to disk. Delimiter (comma, semicolon, tab, pipe) and encoding (UTF-8, UTF-16 LE/BE,
   Windows-1252 fallback) are detected from a bounded sample and shown to the operator, who can
   override both before validation.

2. **Column mapping with templates** - A mapping screen pairs each CSV header with a target field
   or "ignore". Mappings are saved as named templates keyed by a header signature; uploading a
   file with a known signature pre-fills its template. sku, name, and price must be mapped.

3. **Validation pass with row-level report** - A worker job streams the file, normalizes and
   validates every row against precise rules (see architecture), and records one row per problem:
   phase, row number, column, stable error code, severity, message. The report is browsable,
   filterable, and downloadable as CSV.

4. **Dry run** - The same validation pass computes would-create, would-update, and would-skip
   counts against the current catalog without writing a single product row, so the operator sees
   the blast radius before committing.

5. **Exactly-once batched apply with progress** - Apply processes valid rows in 1000-row batches,
   one transaction per batch, each recorded in a ledger with a unique constraint. Progress (rows
   processed, counts, current batch) is served by a lightweight status endpoint polled by the UI.

6. **Idempotent upserts by SKU** - Each row carries a content hash over its normalized mapped
   values. An existing product with the same SKU and hash is skipped; otherwise the row is
   created or updated. Re-importing an identical file with the same mapping yields zero changes.

7. **Resume, pause, and safe cancellation** - A bad row is skipped (recorded in the report); a
   failed batch is retried with backoff; three consecutive failures of the same batch pause the
   import with the reason recorded. Cancellation takes effect between batches, never mid
   transaction. Paused, cancelled, and crashed imports resume from the ledger.

8. **Import history and change audit** - Every import keeps its stats (totals, counts, timings)
   and an audit trail: each created product with its values, each updated product with old and
   new values per changed field.

9. **Concurrency safety** - Imports target a catalog; a database-backed advisory lock allows only
   one applying import per catalog, so concurrent imports can never interleave writes to the
   same SKUs. Multiple worker processes are safe; one is the default.

## Non-goals

- Excel or any non-CSV format; CSV only.
- Downloading, validating, or resizing images; image urls are stored as-is.
- Export of products or reports beyond the validation-report CSV.
- Multi-user accounts, roles, or permissions. Single operator; v1 ships without authentication
  and is meant for localhost or a trusted network (documented trade-off in architecture).
- A product editing UI; products are written only by the import engine.
- Scheduled imports, watch folders, FTP/API feed pulls.
- Real-time push (websockets/SSE); progress is polled.
- Currency conversion or per-locale price configuration; one deterministic normalization rule.

## Success criteria per core feature

- **Upload/detection** - A 500,000-row file uploads with worker and web process memory staying
  bounded (no full-file reads anywhere); semicolon, tab, and pipe files are detected correctly;
  UTF-8, UTF-16 LE (BOM), and Windows-1252 samples decode correctly; an oversize upload returns
  413 and leaves no orphan file; detection uncertainty is flagged and overridable.
- **Mapping** - Saving a mapping without sku, name, and price mapped is rejected with field
  errors; a template saved for a header set pre-fills on the next matching upload; remapping a
  validated import re-runs validation.
- **Validation report** - A file with a bad price, a missing sku, a short row, and a duplicate
  sku yields exactly the documented codes at the right row numbers; the CSV download matches the
  browsable report; row numbers match spreadsheet row numbers for files without embedded newlines.
- **Dry run** - Against a seeded catalog, would-create/update/skip counts equal the later apply
  counts when nothing else touches the catalog in between.
- **Apply** - A 10,000-row file applies in 10 ledger-recorded batches; killing the worker after
  batch N and restarting resumes at batch N+1 with no product written twice; forcing the same
  batch to apply twice is rejected by the ledger's unique constraint.
- **Idempotency** - Importing the same file twice with the same mapping: second run reports all
  rows skipped, zero creates, zero updates, and products' updated_at values are unchanged.
- **Resume/pause/cancel** - A batch made to fail three times pauses the import with the batch
  number and reason recorded; resume retries that batch and completes; cancel during apply stops
  between batches and the import resumes later from the ledger.
- **History/audit** - After two imports touching overlapping SKUs, each import's detail shows its
  own counts and its own created/updated rows with correct old and new values.
- **Concurrency** - Two imports applying to one catalog: the second is paused with reason
  catalog_locked and succeeds after resume once the first finishes; two workers never claim the
  same job (asserted by a contention test).
