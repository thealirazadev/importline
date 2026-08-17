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

export type RowValidationResult =
  | { ok: true; value: NormalizedRow; hash: string }
  | { ok: false; errors: RowValidationError[] };

export function validateAndNormalizeRow(
  rawRow: Record<string, string>,
  mapping: Mapping,
  headerCount: number,
  columnCount: number
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

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const normalized: NormalizedRow = {
    sku,
    name,
    price_cents: priceResult!.value,
    stock: stockResult?.value || 0,
    category: mapping.category ? normalizeText(rawRow[mapping.category] || "") || null : null,
    description: mapping.description ? normalizeText(rawRow[mapping.description] || "") || null : null,
    image_url: mapping.image_url
      ? normalizeUrl(rawRow[mapping.image_url] || "").ok
        ? normalizeUrl(rawRow[mapping.image_url] || "").value || null
        : null
      : null,
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
