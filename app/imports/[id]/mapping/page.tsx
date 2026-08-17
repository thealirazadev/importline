"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Import {
  id: number;
  originalFilename: string;
  delimiter: string;
  encoding: string;
  headerJson: string;
  mappingJson: string | null;
}

interface Preview {
  headers: string[];
  rows: Record<string, string>[];
}

interface MappingTemplate {
  id: number;
  name: string;
  mappingJson: string;
  headerSignature: string;
}

export default function MappingPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [importData, setImportData] = useState<Import | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [templates, setTemplates] = useState<MappingTemplate[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [templateName, setTemplateName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const { id } = await params;
        const importRes = await fetch(`/api/imports/${id}`);
        if (!importRes.ok) throw new Error("Failed to load import");
        const importResp = await importRes.json();
        const importRow = importResp.data;
        setImportData(importRow);

        const previewRes = await fetch(`/api/imports/${id}/preview`);
        if (!previewRes.ok) throw new Error("Failed to load preview");
        const previewResp = await previewRes.json();
        setPreview(previewResp.data);

        const templatesRes = await fetch("/api/mapping-templates");
        if (templatesRes.ok) {
          const templatesResp = await templatesRes.json();
          setTemplates(templatesResp.data || []);
        }

        // Try to prefill from template
        const headers = JSON.parse(importRow.headerJson) as string[];
        const signature = headers.sort().join("|");
        const matchingTemplate = templates.find((t) => t.headerSignature === signature);
        if (matchingTemplate) {
          const templateMapping = JSON.parse(matchingTemplate.mappingJson);
          setMapping(templateMapping);
        } else {
          setMapping({});
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [params, templates]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { id } = await params;
      const res = await fetch(`/api/imports/${id}/mapping`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mapping,
          template_name: templateName || undefined,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error?.message || "Failed to save mapping");
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
        <h1 className="text-2xl font-bold mt-4">{importData.originalFilename}</h1>
        <p className="text-gray-600">Map columns to product fields</p>
      </div>

      {error && <div className="mb-4 p-3 bg-red-100 text-red-800 rounded">{error}</div>}

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
        {headers.map((header) => (
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
              <p className="text-xs text-gray-500 mt-1">Example: {preview.rows[0][header]}</p>
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
