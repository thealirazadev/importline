import { describe, expect, it } from "vitest";
import { reportCsvCell, reportCsvLine } from "@/lib/csv/report";

describe("report csv cells", () => {
  it("prefixes formula-looking cells with a quote", () => {
    expect(reportCsvCell("=1+1")).toBe("'=1+1");
    expect(reportCsvCell("+1")).toBe("'+1");
    expect(reportCsvCell("-1")).toBe("'-1");
    expect(reportCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(reportCsvCell("\t=1")).toBe("'\t=1");
  });

  it("still neutralizes a formula cell that also needs quoting", () => {
    expect(reportCsvCell('=HYPERLINK("http://x","a,b")')).toBe(
      `"'=HYPERLINK(""http://x"",""a,b"")"`,
    );
    expect(reportCsvCell("=1,2")).toBe(`"'=1,2"`);
  });

  it("quotes cells with separators, quotes, and line breaks", () => {
    expect(reportCsvCell("a,b")).toBe(`"a,b"`);
    expect(reportCsvCell('say "hi"')).toBe(`"say ""hi"""`);
    expect(reportCsvCell("a\nb")).toBe(`"a\nb"`);
    expect(reportCsvCell("a\rb")).toBe(`"a\rb"`);
  });

  it("writes numbers and empty values as is", () => {
    expect(reportCsvCell(12)).toBe("12");
    expect(reportCsvCell(null)).toBe("");
    expect(reportCsvLine([2, "validate", null, "price_invalid"])).toBe(
      "2,validate,,price_invalid\n",
    );
  });
});
