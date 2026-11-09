/**
 * One CSV cell for a report a spreadsheet will open.
 *
 * Formula-looking values get a leading apostrophe first, then quoting is applied, so a value
 * like `=HYPERLINK("x"),y` is both neutralized and correctly quoted.
 */
export function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  let cell = String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  if (/[",\n\r]/.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
  return cell;
}
