# API Contracts - importline

One HTTP surface: a JSON API under `/api`, consumed by the app's own pages (server components
fetch directly through `lib/`; client components fetch these routes). There is no auth in v1 (see
PRD non-goals); every route is operator-facing. All timestamps are ISO-8601 UTC. All ids are
integers. Prices travel as integer `price_cents`.

Success envelope: `{ "data": ... }`. Lists add `{ "meta": { "page", "per_page", "total" } }`.
Pagination params: `page` (default 1), `per_page` (default 50, max 200).

## Error envelope (every API error)

```json
{
  "error": {
    "code": "state_conflict",
    "message": "This import is not in a state that allows applying.",
    "details": { "state": "applying" }
  }
}
```

`details` is optional and safe for display. Stable API error codes:

| HTTP | `error.code` | When |
|---|---|---|
| 400 | `validation_failed` | Request body/params invalid; `details` holds field errors. |
| 404 | `not_found` | Unknown import, catalog, template, or product. |
| 409 | `state_conflict` | Action not allowed in the current state, or a lost conditional-transition race. |
| 409 | `catalog_locked` | Another import currently holds this catalog's lock. |
| 413 | `file_too_large` | Upload exceeds `IMPORT_MAX_FILE_MB`. |
| 415 | `unsupported_media_type` | Upload is not multipart/form-data with a file part. |
| 500 | `server_error` | Unexpected error; details logged, never returned. |

## Row report codes (import_row_errors.code)

Stable codes; the report CSV and API both use them. Severity `error` excludes the row from
apply; `warning` does not.

| Code | Severity | Meaning |
|---|---|---|
| `columns_mismatch` | error | Record cell count differs from the header. |
| `missing_required` | error | sku, name, or price empty; `column` names which. |
| `field_too_long` | error | Value exceeds the field's length cap. |
| `price_invalid` | error | Price contains disallowed characters or malformed separators. |
| `price_negative` | error | Price is negative. |
| `price_precision` | error | More than 2 decimal digits after normalization. |
| `price_out_of_range` | error | Over 9,999,999,999 cents. |
| `stock_invalid` | error | Stock is not an integer after normalization. |
| `stock_negative` | error | Stock is negative. |
| `stock_out_of_range` | error | Over 1,000,000,000. |
| `url_invalid` | error | image_url is not an absolute http/https URL. |
| `duplicate_sku` | warning | SKU already appeared earlier in this file; last occurrence wins. |
| `encoding_replacement` | warning | Row contained invalid byte sequences decoded as U+FFFD. |
| `row_unprocessable` | error | Apply-phase unexpected failure for this row (rare; batch aborted and retried). |

`row_number` is the CSV record number counting the header as 1 (first data row = 2), which
matches spreadsheet row numbers unless fields contain embedded newlines.

---

## Imports

### POST /api/imports

`multipart/form-data`: `file` (required, the CSV), `catalog_id` (required), `source_label`
(optional, max 128). The body is streamed to disk; the response includes detection results and
any matching template.

Response `201`:
```json
{
  "data": {
    "id": 12,
    "catalog_id": 1,
    "source_label": "supplier-x monthly",
    "original_filename": "products-july.csv",
    "file_size_bytes": 10485760,
    "file_sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "delimiter": ";",
    "delimiter_uncertain": false,
    "encoding": "utf-8",
    "headers": ["SKU", "Title", "Price EUR", "Qty", "Group", "Text", "Image"],
    "state": "uploaded",
    "matched_template": { "id": 3, "name": "supplier-x", "mapping": { "SKU": "sku" } },
    "created_at": "2026-07-27T10:00:00Z"
  }
}
```

Errors: 400 `validation_failed` (missing file/catalog, unknown catalog in `details`),
413 `file_too_large`, 415 `unsupported_media_type`.

### GET /api/imports?catalog_id=&state=&page=&per_page=

Response `200`: `data` is an array of import summaries (the detail shape below minus `headers`
and `mapping`), newest first, plus `meta`.

### GET /api/imports/{id}

Response `200`:
```json
{
  "data": {
    "id": 12,
    "catalog_id": 1,
    "source_label": "supplier-x monthly",
    "original_filename": "products-july.csv",
    "file_size_bytes": 10485760,
    "delimiter": ";",
    "encoding": "utf-8",
    "state": "validated",
    "headers": ["SKU", "Title", "Price EUR", "Qty", "Group", "Text", "Image"],
    "mapping": { "SKU": "sku", "Title": "name", "Price EUR": "price", "Qty": "stock" },
    "total_rows": 100000,
    "error_rows": 42,
    "warning_rows": 7,
    "dry_run": { "would_create": 25000, "would_update": 60000, "would_skip": 14958 },
    "result": { "created": 0, "updated": 0, "skipped": 0 },
    "batch_size": 1000,
    "last_committed_batch": 0,
    "failing_batch": null,
    "pause_reason": null,
    "started_at": null,
    "finished_at": null,
    "created_at": "2026-07-27T10:00:00Z"
  }
}
```

### GET /api/imports/{id}/status

The lightweight poll payload (single-row read; poll every 2 s while active):

```json
{
  "data": {
    "state": "applying",
    "total_rows": 100000,
    "processed_rows": 43000,
    "current_batch": 43,
    "total_batches": 100,
    "result": { "created": 9800, "updated": 30150, "skipped": 3050 },
    "error_rows": 42,
    "pause_reason": null,
    "cancel_requested": false
  }
}
```

`current_batch` is `last_committed_batch + 1` while applying; `total_batches` is derived from
valid rows and `batch_size`. During `validating`, `processed_rows` counts validated records.

### GET /api/imports/{id}/preview

Response `200`: `{ "data": { "headers": [...], "rows": [["A-1", "Anvil", "9,99", ...], ...] } }`
with at most 20 rows, parsed with the import's stored delimiter and encoding. Used by the
mapping screen for sample values.

### PUT /api/imports/{id}/mapping

Allowed in states `uploaded` and `validated`; transitions to `validating` and enqueues the
validate job.

Request:
```json
{
  "mapping": { "SKU": "sku", "Title": "name", "Price EUR": "price", "Qty": "stock" },
  "delimiter": ";",
  "encoding": "windows-1252",
  "save_template": "supplier-x"
}
```

Rules: every key must be a header of this file; values are one of `sku`, `name`, `price`,
`stock`, `category`, `description`, `image_url` (headers absent from the map are ignored
columns); each target field mapped at most once; `sku`, `name`, and `price` must be mapped.
`delimiter`/`encoding` are optional overrides re-checked against the allowed sets;
`save_template` (optional, max 128) upserts a template by name for this header signature.

Response `200`: the import detail shape, `state: "validating"`.
Errors: 400 `validation_failed` with per-field `details`; 409 `state_conflict`.

### POST /api/imports/{id}/apply

Allowed in state `validated`. Pre-checks the catalog lock. Response `202` with the detail shape
(`state: "applying"`). Errors: 409 `state_conflict`, 409 `catalog_locked`.

### POST /api/imports/{id}/cancel

In `uploaded`/`validated`: immediate transition to `cancelled`. In `validating`/`applying`: sets
`cancel_requested`; the worker completes or rolls back the in-flight batch, then cancels.
Response `202` (or `200` for the immediate case) with the detail shape. Error: 409
`state_conflict` in terminal states.

### POST /api/imports/{id}/resume

Allowed in `paused`, and in `cancelled` only if the import had entered applying (a ledger exists
or `started_at` is set). Fresh apply job, fresh retry budget, resumes after
`last_committed_batch`. Response `202` with the detail shape. Errors: 409 `state_conflict`,
409 `catalog_locked`.

### GET /api/imports/{id}/errors?severity=&code=&page=&per_page=

Response `200`:
```json
{
  "data": [
    { "row_number": 2, "column": "Price EUR", "code": "price_invalid",
      "severity": "error", "phase": "validate",
      "message": "Price \"9,9,9\" has malformed separators." }
  ],
  "meta": { "page": 1, "per_page": 50, "total": 49 }
}
```

### GET /api/imports/{id}/errors/csv

Streams `text/csv; charset=utf-8` with `Content-Disposition: attachment;
filename="import-12-report.csv"`. Columns: `row_number,phase,severity,column,code,message`.
Cells starting with `=`, `+`, `-`, or `@` are prefixed with `'` (CSV injection defense).

### GET /api/imports/{id}/changes?action=&page=&per_page=

Response `200`:
```json
{
  "data": [
    { "sku": "A-1", "action": "update", "batch_number": 3,
      "fields": { "price_cents": [999, 1099], "stock": [10, 4] } },
    { "sku": "B-7", "action": "create", "batch_number": 3,
      "fields": { "name": "Anvil XL", "price_cents": 2499, "stock": 12 } }
  ],
  "meta": { "page": 1, "per_page": 50, "total": 84958 }
}
```

`update` fields map to `[old, new]` pairs for changed fields only; `create` fields hold the
created values. Skips are counted on the import, never listed here.

---

## Catalogs, templates, products

### GET /api/catalogs

`200`: `{ "data": [ { "id": 1, "name": "default", "product_count": 152340 } ] }`

### POST /api/catalogs

Request: `{ "name": "wholesale" }` (1-128 chars, unique). `201` with the catalog. Errors:
400 `validation_failed` (taken name in `details`).

### GET /api/templates

`200`: `{ "data": [ { "id": 3, "name": "supplier-x", "header_signature": "9f86...",
"mapping": { "SKU": "sku" }, "last_used_at": "2026-07-27T10:05:00Z" } ] }`

Templates are created/updated through the mapping save (`save_template`), not a POST here.

### DELETE /api/templates/{id}

`200`: `{ "data": { "deleted": true } }`. Error: 404 `not_found`.

### GET /api/products?catalog_id=&q=&page=&per_page=

`q` matches SKU or name as a case-insensitive substring. Response `200`:
```json
{
  "data": [
    { "id": 88, "catalog_id": 1, "sku": "A-1", "name": "Anvil", "price_cents": 1099,
      "stock": 4, "category": "hardware", "image_url": "https://cdn.example.com/a1.jpg",
      "last_import_id": 12, "updated_at": "2026-07-27T10:20:11Z" }
  ],
  "meta": { "page": 1, "per_page": 50, "total": 152340 }
}
```

---

## Route summary

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/imports` | Streamed CSV upload + detection. |
| GET | `/api/imports` | Import history, filterable. |
| GET | `/api/imports/{id}` | Full import detail. |
| GET | `/api/imports/{id}/status` | Lightweight poll payload. |
| GET | `/api/imports/{id}/preview` | Headers + first 20 parsed rows. |
| PUT | `/api/imports/{id}/mapping` | Save mapping/overrides/template; start validation. |
| POST | `/api/imports/{id}/apply` | Start apply (validated only). |
| POST | `/api/imports/{id}/cancel` | Cancel now or request cancel between batches. |
| POST | `/api/imports/{id}/resume` | Resume a paused/cancelled apply from the ledger. |
| GET | `/api/imports/{id}/errors` | Paginated row report. |
| GET | `/api/imports/{id}/errors/csv` | Report download (streamed CSV). |
| GET | `/api/imports/{id}/changes` | Paginated change audit. |
| GET | `/api/catalogs` | List catalogs with product counts. |
| POST | `/api/catalogs` | Create a catalog. |
| GET | `/api/templates` | List mapping templates. |
| DELETE | `/api/templates/{id}` | Delete a template. |
| GET | `/api/products` | Browse/search a catalog. |

Anything not listed does not exist. Mutating routes are POST/PUT/DELETE with JSON bodies (except
the multipart upload); unknown fields in request bodies are rejected with `validation_failed`.
