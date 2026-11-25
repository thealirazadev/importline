# Design decisions

The engineering choices behind importline as it stands today: upload, detection, mapping,
validation, the dry run, the report, and the job queue that runs them. Each section describes
behavior the code implements. The batched apply, the batch ledger, resume and the catalog lock are
designed in `docs/architecture.md` (the tables already exist in the schema) but are not implemented
yet, so they are not described here.

## 1. A separate worker process on a database-backed queue

Long work runs in `worker/index.ts`, a separate process started with `tsx`, rather than in a route
handler hit by cron. A validation pass over 500,000 rows runs for minutes, has to heartbeat, and
must survive a web-process restart, none of which fit inside a request timeout. The worker imports
the same `lib/` modules and Prisma client as the web app, so there is no second build pipeline.

The queue is the `jobs` table instead of a queue dependency. `claimNextJob` finds the oldest queued
job whose `run_after` has passed and claims it with a compare-and-set
`updateMany({ where: { id, state: "queued" } })`; a row count of 0 means another worker won, and it
moves on to the next candidate. This gives exactly one winner without engine-specific SQL, so
running several workers is safe. A running job heartbeats every 10 seconds, and a janitor in the
poll loop returns any job whose heartbeat is older than 60 seconds to the queue with `attempts + 1`.
The same janitor deletes `.part` files that aborted uploads left in the temp directory once they
are a day old.

The worker decides whether it was started directly by matching `process.argv[1]`, not
`import.meta.url`, because the package is CommonJS and tsx compiles the worker to CJS, where
`import.meta` is unavailable. Tests import the module without starting the poll loop.

## 2. Uploads are parsed by a streaming multipart reader

`request.formData()` buffers the entire body in memory, which would break the bounded-memory goal
for multi-hundred-megabyte files. `lib/upload.ts` is a small streaming multipart parser instead: the
file part is written straight to a temp file while a SHA-256 context, a byte counter and the first
64 KB (the detection sample) are maintained incrementally. It keeps a boundary-length tail between
chunks so a boundary split across two reads is still found.

The size cap is enforced while streaming, not after: the first chunk that would cross
`IMPORT_MAX_FILE_MB` throws, the temp file is deleted, and the route returns 413 before any import
row exists. An aborted request or a body without its closing boundary takes the same path, so
neither leaves an orphan row or file. Text fields are capped at 4 KB and part headers at 8 KB, and
only one file part is accepted.

## 3. The import row is created before the file is moved into place

The stored file is named `<import id>-<sha256 prefix>.csv`, so the row has to exist first. The
upload route creates the row pointing at the temp path, renames the file into
`IMPORTLINE_DATA_DIR`, and then updates the path. If the rename fails, the row is deleted, so no
import can point at a file that does not exist. Paths are always server-generated: the original
filename is stripped of control characters and path separators and is used for display only.

## 4. Encoding and delimiter are detected from a bounded sample

Detection reads only the 64 KB sample. Encoding is decided by BOM (UTF-8, UTF-16 LE, UTF-16 BE),
then by a strict UTF-8 decode, falling back to Windows-1252, which maps every byte and so cannot
fail. A multi-byte UTF-8 sequence cut in half by the sample boundary is trimmed before the strict
decode; without that, a valid UTF-8 file could be misdetected as Windows-1252 purely because of
where the sample ended.

Each candidate delimiter (comma, semicolon, tab, pipe) is scored by parsing the first 50 records and
counting how many share the most common column count. A candidate that only ever yields one column
never appeared and scores zero. Ties break by that precedence order, and the trailing partial
record of the sample is dropped before scoring. When no candidate qualifies, the import is flagged
`delimiter_uncertain` with comma as the default, and the operator can override delimiter and
encoding when saving the mapping.

## 5. CSV reading streams end to end, with spreadsheet row numbers

`lib/csv/stream.ts` pipes a file read stream through a `TextDecoder` transform into papaparse's
Node stream parser, and consumers read it as an async iterator, so backpressure reaches back to the
file handle and nothing holds the whole file. Decoding happens before papaparse because Node's
WHATWG decoder covers all four detected encodings without an iconv dependency. Empty decoder output
is never pushed downstream, because papaparse treats an empty write as the end of input.

Every record carries its CSV record number with the header as row 1, which matches what a
spreadsheet shows. An earlier version counted data rows instead and reported every problem one row
too low. The generator tears its streams down in a `finally` block, so an early stop (such as the
20-row mapping preview) never leaves a file handle open.

## 6. One locale-free normalization rule set

Validation runs every row through `lib/normalize`. Text is NFC-normalized, stripped of C0 and C1
control characters (tab excepted), and trimmed. Length caps (sku 64, name 256, category 128,
description 8192, image url 2048) reject an over-long value with `field_too_long`; nothing is ever
truncated silently. Image urls must be absolute `http` or `https` and are stored, never fetched.

Prices follow one deterministic reading rather than a per-import locale setting: digit groups
written with a no-break or narrow no-break space are joined, a leading or trailing currency symbol
or three-letter code is stripped, the rightmost separator wins when both `.` and `,` appear, and a
single separator followed by exactly three digits is a thousands separator. Prices become integer
cents with at most two decimals; `1,234` therefore reads as 1234, and its other possible reading
(1.234) would fail the precision rule anyway. Negative values, more than two decimals and values
out of range each get their own error code.

## 7. Row problems are data, not log lines

Every finding is a row in `import_row_errors` with phase, row number, column, a stable code,
severity and message, written with `createMany` in groups of 500. The log stream records only the
pass and its totals, so a file with 100,000 bad rows does not produce 100,000 log lines.
Re-validation deletes the import's previous rows first. Messages echo at most a short excerpt of
the offending cell, and every cell value renders through React's escaping.

Cancellation is checked once every 500 rows rather than on every row; an earlier version read the
import row from the database once per CSV row. Validation also stops with `row_limit_exceeded` past
500,000 rows.

## 8. A content hash per row drives the dry run

Each valid row gets a SHA-256 over its normalized fields, sorted by name and joined with the ASCII
unit separator, with price as integer cents and absent values written as an explicit null marker.
Hashing normalized values instead of the raw CSV line means formatting-only differences such as
`9,99` and `9.99` produce the same hash. After the pass, the SKUs seen are looked up against the
catalog in chunks of 1000, and each one counts as would-create (unknown SKU), would-skip (same hash
as the stored product) or would-update, so the operator sees what an apply would change before
anything is written.

A SKU that appears twice in one file is reported as a `duplicate_sku` warning naming the earlier
row, and the last occurrence wins. The SKU map is the one structure that grows with the number of
distinct SKUs; everything else is bounded by a chunk.

## 9. The mapping API speaks headers, and the transition is atomic

`PUT /api/imports/{id}/mapping` takes `{ header: field }`, the shape the mapping screen sends.
`lib/import/mapping.ts` is the only place that converts it to the internal `{ field: header }`
form, and it rejects unknown headers, unknown fields and a field mapped twice, and requires sku,
name and price. An earlier version expected the inverted shape, so neither the API nor the screen
could save a mapping.

Saving moves the import to `validating`, enqueues its validate job, and upserts the named template
in one transaction. The state change is a guarded update that only matches `uploaded` or
`validated`, so a concurrent change surfaces as a 409 `state_conflict` instead of a 500, and an
import never gets two live validate jobs.

## 10. Templates are matched by header signature

A template's key is the SHA-256 of the file's ordered, NFC-normalized, trimmed headers. On upload,
the route looks up a template with the same signature (most recently used first) and returns it as
`matched_template`, and the mapping screen pre-fills from it. Matching on the full ordered header
list means a supplier file that adds, drops or reorders a column does not silently reuse a mapping
built for a different layout.

## 11. The CSV report neutralizes formulas before quoting

The downloadable report is opened in spreadsheet software and its messages can echo
attacker-controlled cell content. `csvCell` prefixes any value starting with `=`, `+`, `-`, `@`,
a tab or a carriage return with an apostrophe, and only then applies CSV quoting. The order
matters: an earlier version quoted first and skipped the prefix for any value that needed quoting,
so `=HYPERLINK(...)` containing a comma reached the spreadsheet intact. The report streams from the
database in cursor-paged pages of 1000 rows.

## 12. SQLite only, with a portable schema shape

`prisma/schema.prisma` pins the `sqlite` provider, so SQLite is the only supported database and
`lib/env.ts` rejects any `DATABASE_URL` that is not a `file:` URL at startup instead of letting
Prisma fail later. JSON payloads (`header_json`, `mapping_json`, `fields_json`) are stored as TEXT
because Prisma's SQLite connector has no Json type, and length caps live in the normalization rules
instead of engine-specific column types, so a PostgreSQL provider could be added later without
reshaping tables; that would need its own migrations and CI coverage and has not been done. SQLite
keeps a deployment to one process pair and one file; `lib/db.ts` turns on WAL and a 5-second busy timeout once per process so the web
and worker processes can write to the same file. Those two pragmas are guarded by a `file:` URL
check and are the only engine-specific SQL in the codebase.

## 13. Fail-fast configuration and server-only modules

All configuration is five env values read through `lib/env.ts`, which validates types and ranges
at startup and throws with every problem listed; worker timings and the row cap are constants in
code. `lib/env.ts` and `lib/db.ts` throw if they are ever evaluated in a browser, which gives the
same protection as the `server-only` package without adding a dependency. The tsx entry points load
`.env` with Node's `--env-file-if-exists` instead of dotenv.

## 14. No authentication, by design

importline is a single-operator tool meant for localhost or a trusted network, and it ships without
authentication. Adding it would touch every route, page and test for no user of that deployment
shape. Exposing it beyond a trusted network requires an authenticating reverse proxy in front of it.
