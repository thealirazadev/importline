import type { Mapping } from "@/lib/validate/row";

/**
 * Mapping payload rules from docs/api-contracts.md. The payload maps file headers to target
 * fields (`{ "Price EUR": "price" }`); headers left out, or mapped to null or "", are ignored.
 */

export const TARGET_FIELDS = [
  "sku",
  "name",
  "price",
  "stock",
  "category",
  "description",
  "image_url",
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

const REQUIRED_FIELDS: TargetField[] = ["sku", "name", "price"];

export type HeaderMapping = Record<string, TargetField>;

export type MappingCheck =
  { ok: true; mapping: HeaderMapping } | { ok: false; errors: Record<string, string> };

function isTargetField(value: string): value is TargetField {
  return (TARGET_FIELDS as readonly string[]).includes(value);
}

export function checkMapping(raw: unknown, headers: string[]): MappingCheck {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: { mapping: "mapping must be an object of header to field." } };
  }
  const headerSet = new Set(headers);
  const errors: Record<string, string> = {};
  const mapping: HeaderMapping = {};
  const seen = new Map<TargetField, string>();

  for (const [header, field] of Object.entries(raw as Record<string, unknown>)) {
    if (field === null || field === "") continue;
    if (!headerSet.has(header)) {
      errors[header] = `Header "${header}" not found in file`;
    } else if (typeof field !== "string" || !isTargetField(field)) {
      errors[header] = `Unknown field: ${String(field)}`;
    } else if (seen.has(field)) {
      errors[header] = `${field} is already mapped to "${seen.get(field)}"`;
    } else {
      seen.set(field, header);
      mapping[header] = field;
    }
  }

  for (const required of REQUIRED_FIELDS) {
    if (!seen.has(required)) errors[required] = `${required} is required`;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, mapping };
}

/** Stored mappings are header to field; row validation looks values up by field. */
export function toFieldMapping(mapping: Record<string, string>): Mapping {
  const byField: Mapping = {};
  for (const [header, field] of Object.entries(mapping)) {
    if (isTargetField(field)) byField[field] = header;
  }
  return byField;
}
