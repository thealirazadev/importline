# Security policy

## Supported versions

Only the latest release on `main` receives security fixes.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting
(Security tab, "Report a vulnerability") or email thealirazadev@gmail.com with the
steps to reproduce. You should get a reply within 72 hours.

## How importline handles sensitive data

- Uploads are streamed to a temporary file, so memory use does not depend on the size of the uploaded file (`lib/upload.ts`).
- Text fields in an upload are capped at 4 KB and header lines at 8 KB (`lib/upload.ts`).
- The downloadable error report neutralizes spreadsheet formula injection: a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe before quoting (`lib/csv/cell.ts`, used by `app/api/imports/[id]/errors/csv/route.ts`).
