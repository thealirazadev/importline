import { createHash } from "crypto";
import { normalizeText, parsePrice, parseStock, normalizeUrl, TEXT_LIMITS } from "@/lib/normalize";

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
      message: `Invalid price: ${priceResult?.error || "unknown error"}`,
    });
  }

  const stockRaw = mapping.stock ? rawRow[mapping.stock]?.trim() : "";
  const stockResult = stockRaw ? parseStock(stockRaw) : null;
  if (stockRaw && !stockResult?.ok) {
    errors.push({
      field: mapping.stock || "stock",
      code: `stock_${stockResult?.error || "invalid"}`,
      message: `Invalid stock: ${stockResult?.error || "unknown error"}`,
    });
  }

  const category = mapping.category ? normalizeText(rawRow[mapping.category] || "") : "";
  const description = mapping.description ? normalizeText(rawRow[mapping.description] || "") : "";
  const imageUrl = mapping.image_url ? normalizeText(rawRow[mapping.image_url] || "") : "";

  // Over-cap values are rejected, never truncated.
  const capped: Array<[keyof Mapping, string]> = [
    ["sku", sku],
    ["name", name],
    ["category", category],
    ["description", description],
    ["image_url", imageUrl],
  ];
  for (const [field, value] of capped) {
    const limit = TEXT_LIMITS[field];
    if (limit !== undefined && value.length > limit) {
      errors.push({
        field: mapping[field] || field,
        code: "field_too_long",
        message: `${field} is longer than ${limit} characters`,
      });
    }
  }

  const imageUrlResult = imageUrl ? normalizeUrl(imageUrl) : null;
  if (imageUrlResult && !imageUrlResult.ok && imageUrl.length <= (TEXT_LIMITS.image_url ?? 0)) {
    errors.push({
      field: mapping.image_url || "image_url",
      code: "url_invalid",
      message: "image_url must be an absolute http or https URL",
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
    category: category || null,
    description: description || null,
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
