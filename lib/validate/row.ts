import { createHash } from "crypto";
import { normalizeText, parsePrice, parseStock, normalizeUrl } from "@/lib/normalize";

export interface Mapping {
  sku?: string;
  name?: string;
  price?: string;
  stock?: string;
  category?: string;
  description?: string;
  image_url?: string;
}

export interface NormalizedRow {
  sku: string;
  name: string;
  price_cents: number;
  stock: number;
  category: string | null;
  description: string | null;
  image_url: string | null;
}

export interface RowValidationError {
  field: string;
  code: string;
  message: string;
}

const TEXT_CAPS: Partial<Record<keyof Mapping, number>> = {
  sku: 64,
  name: 256,
  category: 128,
  description: 8192,
  image_url: 2048,
};

/** A short, quoted-safe excerpt of a cell for messages. */
function preview(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed;
}

export type RowValidationResult =
  { ok: true; value: NormalizedRow; hash: string } | { ok: false; errors: RowValidationError[] };

export function validateAndNormalizeRow(
  rawRow: Record<string, string>,
  mapping: Mapping,
  headerCount: number,
  columnCount: number,
): RowValidationResult {
  const errors: RowValidationError[] = [];

  if (columnCount !== headerCount) {
    errors.push({
      field: "",
      code: "columns_mismatch",
      message: `Expected ${headerCount} columns, got ${columnCount}`,
    });
    return { ok: false, errors };
  }

  const sku = mapping.sku ? normalizeText(rawRow[mapping.sku] || "") : "";
  if (!sku) {
    errors.push({
      field: mapping.sku || "sku",
      code: "missing_required",
      message: "SKU is required",
    });
  }

  const name = mapping.name ? normalizeText(rawRow[mapping.name] || "") : "";
  if (!name) {
    errors.push({
      field: mapping.name || "name",
      code: "missing_required",
      message: "Name is required",
    });
  }

  const priceRaw = mapping.price ? rawRow[mapping.price]?.trim() || "" : "";
  if (!priceRaw) {
    errors.push({
      field: mapping.price || "price",
      code: "missing_required",
      message: "Price is required",
    });
  }
  const priceResult = priceRaw ? parsePrice(priceRaw) : null;
  if (priceRaw && !priceResult?.ok) {
    errors.push({
      field: mapping.price || "price",
      code: `price_${priceResult?.error || "invalid"}`,
      message: `Price "${preview(priceRaw)}" is not valid (${priceResult?.error || "invalid"}).`,
    });
  }

  const stockRaw = mapping.stock ? rawRow[mapping.stock]?.trim() : "";
  const stockResult = stockRaw ? parseStock(stockRaw) : null;
  if (stockRaw && !stockResult?.ok) {
    errors.push({
      field: mapping.stock || "stock",
      code: `stock_${stockResult?.error || "invalid"}`,
      message: `Stock "${preview(stockRaw ?? "")}" is not valid (${stockResult?.error || "invalid"}).`,
    });
  }

  // Caps from docs/architecture.md: over cap rejects the row, never truncates.
  const optional = (field: keyof Mapping) =>
    mapping[field] ? normalizeText(rawRow[mapping[field] as string] || "") : "";
  const texts: Array<[keyof Mapping, string]> = [
    ["sku", sku],
    ["name", name],
    ["category", optional("category")],
    ["description", optional("description")],
    ["image_url", optional("image_url")],
  ];
  for (const [field, value] of texts) {
    const cap = TEXT_CAPS[field];
    if (cap !== undefined && value.length > cap) {
      errors.push({
        field: mapping[field] || field,
        code: "field_too_long",
        message: `${field} is ${value.length} characters; the limit is ${cap}.`,
      });
    }
  }

  const imageUrlRaw = mapping.image_url ? rawRow[mapping.image_url] || "" : "";
  const imageUrlResult = imageUrlRaw ? normalizeUrl(imageUrlRaw) : null;
  if (imageUrlResult && !imageUrlResult.ok) {
    errors.push({
      field: mapping.image_url || "image_url",
      code: "url_invalid",
      message: `Image URL "${preview(imageUrlRaw)}" is not an absolute http or https URL.`,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // After error checks, priceResult must be non-null and ok
  const priceCents = priceResult && priceResult.ok ? priceResult.value : 0;
  const stockCount = stockResult && stockResult.ok ? stockResult.value : 0;

  const normalized: NormalizedRow = {
    sku,
    name,
    price_cents: priceCents,
    stock: stockCount,
    category: mapping.category ? normalizeText(rawRow[mapping.category] || "") || null : null,
    description: mapping.description
      ? normalizeText(rawRow[mapping.description] || "") || null
      : null,
    image_url: imageUrlResult && imageUrlResult.ok ? imageUrlResult.value || null : null,
  };

  const hash = computeRowHash(normalized);
  return { ok: true, value: normalized, hash };
}

export function computeRowHash(row: NormalizedRow): string {
  const fields = {
    category: row.category,
    description: row.description,
    image_url: row.image_url,
    name: row.name,
    price_cents: row.price_cents,
    sku: row.sku,
    stock: row.stock,
  };

  const parts = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const v = value === null ? "(null)" : String(value);
      return `${key}=${v}`;
    });

  const buffer = Buffer.from(parts.join(String.fromCharCode(0x1f)), "utf8");
  return createHash("sha256").update(buffer).digest("hex");
}
