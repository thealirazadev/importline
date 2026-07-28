"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Catalog = { id: number; name: string };

type ErrorEnvelope = { error?: { message?: string } };

export function UploadForm({ catalogs }: { catalogs: Catalog[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/imports", { method: "POST", body: new FormData(form) });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorEnvelope;
        setMessage(body.error?.message ?? "The upload failed. Please try again.");
        return;
      }
      form.reset();
      router.push("/imports");
      router.refresh();
    } catch {
      setMessage("The upload could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      {message !== null && (
        <p role="alert" className="rounded-card border border-danger px-3 py-2 text-danger">
          {message}
        </p>
      )}
      <div>
        <label htmlFor="catalog_id" className="mb-1 block font-medium">
          Catalog
        </label>
        <select
          id="catalog_id"
          name="catalog_id"
          required
          className="w-full rounded-card border border-border bg-surface px-3 py-2"
        >
          {catalogs.map((catalog) => (
            <option key={catalog.id} value={catalog.id}>
              {catalog.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="source_label" className="mb-1 block font-medium">
          Source label <span className="text-muted">(optional)</span>
        </label>
        <input
          id="source_label"
          name="source_label"
          type="text"
          maxLength={128}
          className="w-full rounded-card border border-border bg-surface px-3 py-2"
        />
      </div>
      <div>
        <label htmlFor="file" className="mb-1 block font-medium">
          CSV file
        </label>
        <input id="file" name="file" type="file" accept=".csv,text/csv" required />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="rounded-card bg-accent px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        {busy ? "Uploading..." : "Upload"}
      </button>
    </form>
  );
}
