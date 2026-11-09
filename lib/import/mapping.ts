import { createHash } from "node:crypto";

/**
 * Mapping shapes. The API speaks the documented `{ header: field }` form (docs/api-contracts.md);
 * the validator works with `{ field: header }`. Conversion happens only here.
 */
export type HeaderMap = Record<string, string>;
export type FieldMap = Partial<Record<ProductField, string>>;

export const PRODUCT_FIELDS = [
  "sku",
  "name",
  "price",
  "stock",
  "category",
  "description",
  "image_url",
] as const;
export type ProductField = (typeof PRODUCT_FIELDS)[number];
export const REQUIRED_FIELDS: readonly ProductField[] = ["sku", "name", "price"];

const FIELD_SET = new Set<string>(PRODUCT_FIELDS);

/** sha256 of the ordered, NFC-normalized, trimmed headers (docs/architecture.md). */
export function headerSignature(headers: readonly string[]): string {
  const normalized = headers.map((h) => h.normalize("NFC").trim());
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/**
 * Validate a `{ header: field }` mapping against this file's headers. Returns the internal
 * `{ field: header }` map, or per-key error details for a 400 `validation_failed`.
 */
export function validateMapping(
  headers: readonly string[],
  mapping: unknown,
): { fieldMap: FieldMap; errors: null } | { fieldMap: null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping)) {
    return { fieldMap: null, errors: { mapping: "mapping must be an object of header: field" } };
  }
  const headerSet = new Set(headers);
  const fieldMap: FieldMap = {};
  for (const [header, field] of Object.entries(mapping as Record<string, unknown>)) {
    if (field === null || field === "") continue; // an ignored column
    if (!headerSet.has(header)) {
      errors[header] = `"${header}" is not a header of this file`;
    } else if (typeof field !== "string" || !FIELD_SET.has(field)) {
      errors[header] = `unknown field "${String(field)}"`;
    } else if (fieldMap[field as ProductField] !== undefined) {
      errors[header] = `${field} is already mapped from "${fieldMap[field as ProductField]}"`;
    } else {
      fieldMap[field as ProductField] = header;
    }
  }
  for (const required of REQUIRED_FIELDS) {
    if (fieldMap[required] === undefined) errors[required] ??= `${required} must be mapped`;
  }
  return Object.keys(errors).length ? { fieldMap: null, errors } : { fieldMap, errors: null };
}

/** The internal `{ field: header }` map back in the API's `{ header: field }` form. */
export function toHeaderMap(fieldMap: FieldMap | null): HeaderMap | null {
  if (fieldMap === null) return null;
  const headerMap: HeaderMap = {};
  for (const [field, header] of Object.entries(fieldMap)) {
    if (header) headerMap[header] = field;
  }
  return headerMap;
}
