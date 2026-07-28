import { describe, expect, it } from "vitest";
import { detectDelimiter, detectEncoding, detectFromSample, readHeaders } from "@/lib/csv/detect";

const rows = (delimiter: string) =>
  `sku${delimiter}name${delimiter}price\nA-1${delimiter}Anvil${delimiter}9.99\n` +
  `B-2${delimiter}Bolt${delimiter}1.50\n`;

describe("detectEncoding", () => {
  it("prefers the BOM over content sniffing", () => {
    expect(detectEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toBe("utf-8");
    expect(detectEncoding(Buffer.from([0xff, 0xfe, 0x61, 0x00]))).toBe("utf-16le");
    expect(detectEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x61]))).toBe("utf-16be");
  });

  it("accepts valid utf-8 without a BOM", () => {
    expect(detectEncoding(Buffer.from("sku,name\nA-1,Ançi\n", "utf8"))).toBe("utf-8");
  });

  it("falls back to windows-1252 when strict utf-8 decoding fails", () => {
    // 0xe9 alone is "e acute" in windows-1252 and invalid as utf-8.
    expect(detectEncoding(Buffer.from([0x73, 0x6b, 0x75, 0x2c, 0xe9, 0x0a]))).toBe("windows-1252");
  });

  it("ignores a multi-byte sequence cut off by the sample boundary", () => {
    const full = Buffer.from("sku,name\nA-1,Ançi\n", "utf8");
    expect(detectEncoding(full.subarray(0, full.length - 3))).toBe("utf-8");
  });
});

describe("detectDelimiter", () => {
  it("detects every supported candidate", () => {
    expect(detectDelimiter(rows(","))).toEqual({ delimiter: ",", uncertain: false });
    expect(detectDelimiter(rows(";"))).toEqual({ delimiter: ";", uncertain: false });
    expect(detectDelimiter(rows("\t"))).toEqual({ delimiter: "\t", uncertain: false });
    expect(detectDelimiter(rows("|"))).toEqual({ delimiter: "|", uncertain: false });
  });

  it("flags uncertainty when no candidate produces multiple columns", () => {
    expect(detectDelimiter("one column\nanother line\n")).toEqual({
      delimiter: ",",
      uncertain: true,
    });
  });

  it("breaks ties by candidate precedence", () => {
    const text = "a,b;c\nd,e;f\n";
    expect(detectDelimiter(text).delimiter).toBe(",");
  });
});

describe("readHeaders", () => {
  it("trims and NFC-normalizes header cells", () => {
    const headers = readHeaders(" sku , Príce \nA-1,1\n", ",");
    expect(headers).toEqual(["sku", "Príce"]);
  });
});

describe("detectFromSample", () => {
  it("returns encoding, delimiter, and headers together", () => {
    const sample = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("sku;name\nA-1;Anvil\n", "utf16le"),
    ]);
    expect(detectFromSample(sample)).toEqual({
      encoding: "utf-16le",
      delimiter: ";",
      delimiterUncertain: false,
      headers: ["sku", "name"],
    });
  });
});
