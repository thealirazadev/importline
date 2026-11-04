import { describe, expect, it } from "vitest";
import { checkMapping, toFieldMapping } from "@/lib/import/mapping";

const headers = ["SKU", "Title", "Price EUR", "Qty", "Notes"];

describe("mapping payload", () => {
  it("accepts header to field mappings and drops ignored headers", () => {
    const result = checkMapping(
      { SKU: "sku", Title: "name", "Price EUR": "price", Qty: "stock", Notes: null },
      headers,
    );
    expect(result).toEqual({
      ok: true,
      mapping: { SKU: "sku", Title: "name", "Price EUR": "price", Qty: "stock" },
    });
  });

  it("rejects unknown headers, unknown fields, and fields mapped twice", () => {
    const result = checkMapping(
      { SKU: "sku", Title: "name", "Price EUR": "price", Qty: "name", Missing: "stock", Notes: 3 },
      headers,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["Missing", "Notes", "Qty"]);
  });

  it("requires sku, name, and price", () => {
    const result = checkMapping({ Qty: "stock" }, headers);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["name", "price", "sku"]);
  });

  it("rejects a mapping that is not an object", () => {
    expect(checkMapping(["sku"], headers).ok).toBe(false);
    expect(checkMapping(undefined, headers).ok).toBe(false);
  });

  it("inverts a stored mapping for row validation", () => {
    expect(toFieldMapping({ SKU: "sku", "Price EUR": "price", Odd: "unknown" })).toEqual({
      sku: "SKU",
      price: "Price EUR",
    });
  });
});
