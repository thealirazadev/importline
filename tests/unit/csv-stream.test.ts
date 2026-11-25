import { describe, expect, it } from "vitest";

import { csvOptionsFor, isBlankRecord } from "@/lib/csv/stream";

describe("csvOptionsFor", () => {
  it("keeps a stored delimiter and encoding it recognizes", () => {
    expect(csvOptionsFor({ delimiter: ";", encoding: "utf-8" })).toEqual({
      delimiter: ";",
      encoding: "utf-8",
    });
  });

  it("falls back to comma and utf-8 for unknown stored values", () => {
    expect(csvOptionsFor({ delimiter: "::", encoding: "ebcdic" })).toEqual({
      delimiter: ",",
      encoding: "utf-8",
    });
  });
});

describe("isBlankRecord", () => {
  it("treats empty and whitespace-only single cells as blank", () => {
    expect(isBlankRecord([])).toBe(true);
    expect(isBlankRecord([""])).toBe(true);
    expect(isBlankRecord(["   "])).toBe(true);
  });

  it("keeps records with content or more than one cell", () => {
    expect(isBlankRecord(["sku-1"])).toBe(false);
    expect(isBlankRecord(["", ""])).toBe(false);
  });
});
