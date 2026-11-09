import { describe, expect, it } from "vitest";

import { csvCell } from "@/lib/csv/cell";

describe("csvCell", () => {
  it("neutralizes formulas even when the cell also needs quoting", () => {
    expect(csvCell('=HYPERLINK("http://evil"),x')).toBe('"\'=HYPERLINK(""http://evil""),x"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-3")).toBe("'-3");
    expect(csvCell("@sum")).toBe("'@sum");
  });

  it("quotes commas, quotes, and newlines and leaves plain values alone", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
  });
});
