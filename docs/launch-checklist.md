# Launch Checklist - importline

Work top to bottom before running against a production catalog. Nothing is checked until
verified in the target environment.

## Environment & configuration

- [ ] Production `.env` created from `.env.example` with real values (no dummies).
- [ ] `DATABASE_URL` decided: SQLite file on persistent storage, or PostgreSQL with credentials
      kept out of the repo.
- [ ] `IMPORTLINE_DATA_DIR` on a volume with room for the largest expected CSVs; write
      permissions limited to the app user.
- [ ] `IMPORT_MAX_FILE_MB`, `IMPORT_BATCH_SIZE`, `BATCH_MAX_ATTEMPTS` reviewed for this
      deployment.
- [ ] Migrations applied with `prisma migrate deploy`; rollback path understood.

## Processes

- [ ] Web (`next start`) and worker (`tsx worker/index.ts`) both under a supervisor and
      restarting on failure and on deploy.
- [ ] Deploy procedure restarts the worker so code changes take effect; an in-flight apply
      resumes from the ledger afterward (verified once, on purpose).

## Security

- [ ] The app is not reachable from the public internet, or sits behind a reverse proxy that
      adds authentication (v1 ships none; this line is the deployment's responsibility).
- [ ] `.env` git-ignored; only `.env.example` tracked.
- [ ] Report CSV download spot-checked for formula prefixing (upload a cell starting with `=`).
- [ ] A cell containing HTML renders escaped in the report and audit tables.

## Reliability & observability

- [ ] Structured logs shipped somewhere durable; the documented event keys visible during a
      test import.
- [ ] SIGKILL-the-worker test mid-apply in the production environment: import resumes from the
      ledger, final counts match an uninterrupted run.
- [ ] Forced batch failure pauses with reason and failing batch visible in the UI; resume
      completes.
- [ ] Database and `IMPORTLINE_DATA_DIR` backups scheduled; one restore rehearsed.
- [ ] SQLite deployments: WAL mode confirmed active and busy_timeout set (check on boot log).

## Quality gates

- [ ] `npm run lint`, `npm run typecheck`, `npm test` green on the production build; CI green.
- [ ] Playwright smoke green against the production build with a real worker.
- [ ] `package-lock.json` committed and matching the deployed build.

## Project-specific

- [ ] A realistic full-size supplier file (or the 500k generator fixture) imported end to end;
      worker RSS stayed under 512 MB; wall clock acceptable to the owner.
- [ ] Re-import of that same file: zero creates, zero updates, all skips.
- [ ] Two imports raced against one catalog: second paused `catalog_locked`, resumed cleanly.
- [ ] Dry-run counts on the real file reviewed with the owner before the first production apply.
