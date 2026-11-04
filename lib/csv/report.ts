/**
 * Report CSV writing. Report messages can echo attacker-controlled cell content and the file is
 * destined for spreadsheet software, so formula-looking cells are neutralized before quoting.
 */

// Leading characters a spreadsheet may read as the start of a formula. Tab and carriage return
// are included because some spreadsheets skip them before looking for "=".
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function reportCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportCsvLine(cells: Array<string | number | null | undefined>): string {
  return `${cells.map(reportCsvCell).join(",")}\n`;
}
