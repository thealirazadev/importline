"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { StateBadge } from "@/components/StateBadge";

interface Status {
  state: string;
  total_rows: number | null;
  processed_rows: number;
  dry_run: { would_create: number | null; would_update: number | null; would_skip: number | null };
  result: { created: number; updated: number; skipped: number };
  error_rows: number;
  warning_rows: number;
  pause_reason: string | null;
  cancel_requested: boolean;
}

interface RowError {
  row_number: number;
  column: string | null;
  code: string;
  severity: "error" | "warning";
  message: string;
}

const ACTIVE = new Set(["validating", "applying"]);
const POLL_MS = 2000;
const PER_PAGE = 50;

/** Import detail: validation progress, dry-run counts, and the row report (docs/design.md). */
export default function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [errors, setErrors] = useState<RowError[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  const loadStatus = useCallback(async () => {
    if (id === null) return null;
    const res = await fetch(`/api/imports/${id}/status`);
    if (!res.ok) {
      setLoadError("This import could not be loaded.");
      return null;
    }
    const next = (await res.json()).data as Status;
    setStatus(next);
    return next;
  }, [id]);

  // Poll while the worker is busy; stop once the import settles.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const next = await loadStatus();
      if (next && ACTIVE.has(next.state)) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => clearTimeout(timer);
  }, [loadStatus]);

  useEffect(() => {
    if (id === null || status === null || ACTIVE.has(status.state)) return;
    const query = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (severity) query.set("severity", severity);
    fetch(`/api/imports/${id}/errors?${query}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("report"))))
      .then((body) => {
        setErrors(body.data as RowError[]);
        setTotal(body.meta?.total ?? 0);
      })
      .catch(() => setLoadError("The row report could not be loaded."));
  }, [id, status, page, severity]);

  if (loadError) {
    return (
      <p role="alert" className="rounded-card border border-border bg-surface p-4">
        {loadError}
      </p>
    );
  }
  if (id === null || status === null) return <p className="text-muted">Loading...</p>;

  const progress =
    status.total_rows && status.total_rows > 0
      ? Math.min(100, Math.round((status.processed_rows / status.total_rows) * 100))
      : null;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/imports" className="text-accent hover:underline">
          Back to imports
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Import {id}</h1>
          <StateBadge state={status.state} />
        </div>
      </div>

      {ACTIVE.has(status.state) && (
        <section aria-live="polite" className="rounded-card border border-border bg-surface p-4">
          <p className="font-medium">
            {status.state === "validating" ? "Validating rows" : "Applying changes"}:{" "}
            {status.processed_rows.toLocaleString()}
            {status.total_rows !== null && ` of ${status.total_rows.toLocaleString()}`}
          </p>
          {progress !== null && (
            <progress className="mt-2 w-full" value={progress} max={100} aria-label="Progress" />
          )}
        </section>
      )}

      {status.state === "validated" && (
        <section className="rounded-card border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">Dry run</h2>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Rows" value={status.total_rows} />
            <Stat label="Would create" value={status.dry_run.would_create} />
            <Stat label="Would update" value={status.dry_run.would_update} />
            <Stat label="Would skip" value={status.dry_run.would_skip} />
            <Stat label="Rows with errors" value={status.error_rows} />
          </dl>
          <Link
            href={`/imports/${id}/mapping`}
            className="mt-3 inline-block text-accent hover:underline"
          >
            Change mapping
          </Link>
        </section>
      )}

      {!ACTIVE.has(status.state) && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">
              Row report ({total.toLocaleString()} {total === 1 ? "entry" : "entries"})
            </h2>
            <div className="flex items-center gap-3">
              <label className="text-[0.8125rem]">
                Severity{" "}
                <select
                  value={severity}
                  onChange={(e) => {
                    setSeverity(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-card border border-border bg-surface px-2 py-1"
                >
                  <option value="">All</option>
                  <option value="error">Errors</option>
                  <option value="warning">Warnings</option>
                </select>
              </label>
              <a href={`/api/imports/${id}/errors/csv`} className="text-accent hover:underline">
                Download CSV
              </a>
            </div>
          </div>
          {errors.length === 0 ? (
            <p className="rounded-card border border-border bg-surface p-4 text-muted">
              No problems found.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-card border border-border bg-surface">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border text-[0.8125rem] font-medium text-muted">
                    <th scope="col" className="px-3 py-2">
                      Row
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Severity
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Column
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Code
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Message
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e, i) => (
                    <tr
                      key={`${e.row_number}-${e.code}-${i}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 font-mono">{e.row_number}</td>
                      <td className="px-3 py-2">{e.severity}</td>
                      <td className="px-3 py-2">{e.column ?? "-"}</td>
                      <td className="px-3 py-2 font-mono">{e.code}</td>
                      <td className="px-3 py-2">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <nav aria-label="Report pages" className="flex items-center gap-3">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                Page {page} of {pages}
              </span>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </nav>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-[0.8125rem] text-muted">{label}</dt>
      <dd className="text-lg font-semibold">{value === null ? "-" : value.toLocaleString()}</dd>
    </div>
  );
}
