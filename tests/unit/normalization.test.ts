import { describe, it, expect } from "vitest";
import { normalizeText, parsePrice, parseStock, normalizeUrl, TEXT_LIMITS } from "@/lib/normalize";
import { validateAndNormalizeRow } from "@/lib/validate/row";

describe("text normalization", () => {
  it("normalizes NFC and trims", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  it("removes control characters except tab", () => {
    expect(normalizeText("hello\x00world")).toBe("helloworld");
  });

  it("respects length limits", () => {
    const tooLong = "x".repeat(TEXT_LIMITS.sku! + 1);
    expect(tooLong.length).toBeGreaterThan(TEXT_LIMITS.sku!);
  });
});

describe("price normalization", () => {
  it("parses simple decimals", () => {
    const result = parsePrice("19.99");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1999);
  });

  it("handles thousands separators", () => {
    const result = parsePrice("1,234.56");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(123456);
  });

  it("rejects negative prices", () => {
    const result = parsePrice("-10.00");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("negative");
  });

  it("treats X.YYY as thousands separator", () => {
    const result = parsePrice("10.999");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1099900); // 10,999 in cents
  });

  it("strips currency markers", () => {
    const result = parsePrice("$19.99");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1999);
  });
});

describe("stock normalization", () => {
  it("parses integers", () => {
    const result = parseStock("100");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(100);
  });

  it("handles .00 decimals", () => {
    const result = parseStock("50.00");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(50);
  });

  it("rejects fractional stock", () => {
    const result = parseStock("10.5");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid");
  });

  it("rejects negative stock", () => {
    const result = parseStock("-5");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("negative");
  });
});

describe("url normalization", () => {
  it("accepts http URLs", () => {
    const result = normalizeUrl("http://example.com/image.png");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("http://example.com/image.png");
  });

  it("accepts https URLs", () => {
    const result = normalizeUrl("https://example.com/image.png");
    expect(result.ok).toBe(true);
  });

  it("rejects non-absolute URLs", () => {
    const result = normalizeUrl("/image.png");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid");
  });

  it("returns empty for blank input", () => {
    const result = normalizeUrl("");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("");
  });
});

describe("row validation", () => {
  const mapping = {
    sku: "SKU",
    name: "Name",
    price: "Price",
    stock: "Stock",
  };

  it("validates a good row", () => {
    const row = {
      SKU: "ABC123",
      Name: "Widget",
      Price: "29.99",
      Stock: "100",
    };
    const result = validateAndNormalizeRow(row, mapping, 4, 4);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sku).toBe("ABC123");
      expect(result.value.name).toBe("Widget");
      expect(result.value.price_cents).toBe(2999);
      expect(result.value.stock).toBe(100);
    }
  });

  it("rejects missing sku", () => {
    const row = {
      SKU: "",
      Name: "Widget",
      Price: "29.99",
      Stock: "100",
    };
    const result = validateAndNormalizeRow(row, mapping, 4, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "missing_required")).toBe(true);
    }
  });

  it("rejects column count mismatch", () => {
    const row = {
      SKU: "ABC123",
      Name: "Widget",
      Price: "29.99",
    };
    const result = validateAndNormalizeRow(row, mapping, 4, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "columns_mismatch")).toBe(true);
    }
  });

  it("computes content hash", () => {
    const row = {
      SKU: "ABC",
      Name: "Widget",
      Price: "10.00",
      Stock: "5",
    };
    const result = validateAndNormalizeRow(row, mapping, 4, 4);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hash = result.hash;
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      // Hash should be deterministic
      const result2 = validateAndNormalizeRow(row, mapping, 4, 4);
      if (result2.ok) {
        expect(result2.hash).toBe(hash);
      }
    }
  });
});
