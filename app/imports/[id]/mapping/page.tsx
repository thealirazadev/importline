"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Import {
  id: number;
  original_filename: string;
  headers: string[];
  mapping: Record<string, string> | null;
}

interface Preview {
  headers: string[];
  rows: string[][];
}

interface MappingTemplate {
  id: number;
  name: string;
  header_signature: string;
  mapping: Record<string, string>;
}

/** Same signature as lib/import/mapping.ts: sha256 of the ordered NFC-trimmed headers. */
async function headerSignature(headers: string[]): Promise<string> {
  const normalized = JSON.stringify(headers.map((h) => h.normalize("NFC").trim()));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function MappingPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [importData, setImportData] = useState<Import | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [templateName, setTemplateName] = useState("");
  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const { id } = await params;
        const [importRes, previewRes, templatesRes] = await Promise.all([
          fetch(`/api/imports/${id}`),
          fetch(`/api/imports/${id}/preview`),
          fetch("/api/templates"),
        ]);
        if (!importRes.ok) throw new Error("Failed to load import");
        if (!previewRes.ok) throw new Error("Failed to load preview");
        const importRow = (await importRes.json()).data as Import;
        setImportData(importRow);
        setPreview((await previewRes.json()).data as Preview);

        // An existing mapping wins; otherwise pre-fill from a template for the same headers.
        if (importRow.mapping) {
          setMapping(importRow.mapping);
        } else if (templatesRes.ok) {
          const templates = ((await templatesRes.json()).data ?? []) as MappingTemplate[];
          const signature = await headerSignature(importRow.headers);
          const match = templates.find((t) => t.header_signature === signature);
          if (match) {
            setMapping(match.mapping);
            setPrefilledFrom(match.name);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [params]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { id } = await params;
      const res = await fetch(`/api/imports/${id}/mapping`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapping,
          save_template: templateName || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        setFieldErrors(body.error?.details ?? {});
        throw new Error(body.error?.message || "Failed to save mapping");
      }
      router.push(`/imports/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4">Loading...</div>;
  if (!importData || !preview) return <div className="p-4 text-red-600">{error}</div>;

  const headers = preview.headers;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link href="/imports" className="text-blue-600 hover:underline">
          Back to Imports
        </Link>
        <h1 className="text-2xl font-bold mt-4">{importData.original_filename}</h1>
        <p className="text-gray-600">Map columns to product fields</p>
        {prefilledFrom && (
          <p className="text-sm mt-2">
            Pre-filled from the saved template &ldquo;{prefilledFrom}&rdquo;.
          </p>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 p-3 bg-red-100 text-red-800 rounded">
          {error}
          {["sku", "name", "price"]
            .filter((field) => fieldErrors[field])
            .map((field) => (
              <div key={field}>{fieldErrors[field]}</div>
            ))}
        </div>
      )}

      <div className="mb-6">
        <label className="block font-semibold mb-2">Save as Template (optional)</label>
        <input
          type="text"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="Template name"
          className="border rounded px-3 py-2 w-full"
        />
      </div>

      <div className="space-y-4 mb-6">
        {headers.map((header, column) => (
          <div key={header} className="border rounded p-3">
            <label className="block font-semibold text-sm mb-2">{header}</label>
            <select
              value={mapping[header] || ""}
              onChange={(e) =>
                setMapping({
                  ...mapping,
                  [header]: e.target.value || null,
                })
              }
              className="border rounded px-3 py-2 w-full"
            >
              <option value="">-- Ignore --</option>
              <option value="sku">SKU</option>
              <option value="name">Name</option>
              <option value="price">Price</option>
              <option value="stock">Stock</option>
              <option value="category">Category</option>
              <option value="description">Description</option>
              <option value="image_url">Image URL</option>
            </select>
            {preview.rows[0] && (
              <p className="text-xs text-gray-500 mt-1">Example: {preview.rows[0][column]}</p>
            )}
            {fieldErrors[header] && (
              <p role="alert" className="text-xs text-red-700 mt-1">
                {fieldErrors[header]}
              </p>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Continue"}
      </button>
    </div>
  );
}
