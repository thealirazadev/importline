# Changelog

## Unreleased

### Added

- The import detail page is available, and the mapping screen was fixed.
- Uploads are matched to saved mapping templates by header, and a templates API is documented.
- The import preview API shows what an import would change.
- Text, price, stock and URL values are normalized.
- Row validation computes a content hash for each row.
- Mapping can be saved with per-column overrides.
- Mapping templates are matched by header signature and prefill the mapping screen.
- A streaming validation job produces a row-level report.
- The error report can be downloaded as CSV.
- A status endpoint and progress polling track an import.
- The worker process runs with a janitor that cleans up stale jobs.
- A job queue claims jobs atomically and sends heartbeats.
- Imports can be listed and inspected through an API.
- The upload and history pages are available.
- The streamed CSV upload endpoint accepts files without loading them into memory.
- Encoding and delimiter are detected automatically.
- A catalog seed and catalogs API are available.

### Fixed

- Formula-like values are neutralized before quoting in the CSV report, which streams.
- The API returns the documented error and status payloads.
- Validation enforces length caps and URL checks, and reports spreadsheet row numbers.
- Mapping accepts the documented header shape, returns 409 on conflicts, and returns the detail response.
- Validation jobs run instead of completing as no-ops.
- Next.js and sharp were upgraded, along with vulnerable transitive packages.
