/**
 * Price and stock rules from docs/architecture.md. One locale-free deterministic reading:
 * the rightmost separator wins when both appear, and a single separator followed by exactly
 * three digits is a thousands separator.
 */

export type NumberError = "invalid" | "negative" | "precision" | "out_of_range";
export type NumberResult = { ok: true; value: number } | { ok: false; error: NumberError };

export const PRICE_MAX_CENTS = 9_999_999_999;
export const STOCK_MAX = 1_000_000_000;

// Symbols plus a three-letter ISO code; the code only counts when digits remain beside it.
const LEADING_CURRENCY = /^(?:[$€£]|[a-z]{3})\s*/i;
const TRAILING_CURRENCY = /\s*(?:[$€£]|[a-z]{3})$/i;
// Digit grouping written with a no-break or narrow no-break space.
const SPACE_BETWEEN_DIGITS = /(\d)[  ](?=\d)/g;

type Decimal = { negative: boolean; integer: string; fraction: string };

function stripCurrency(value: string): { value: string; stripped: boolean } {
  const leading = LEADING_CURRENCY.exec(value);
  if (leading !== null && /\d/.test(value.slice(leading[0].length))) {
    return { value: value.slice(leading[0].length).trim(), stripped: true };
  }
  const trailing = TRAILING_CURRENCY.exec(value);
  if (trailing !== null && /\d/.test(value.slice(0, trailing.index))) {
    return { value: value.slice(0, trailing.index).trim(), stripped: true };
  }
  return { value, stripped: false };
}

/** Splits a written number into sign, integer digits, and fraction digits, or null if invalid. */
function parseDecimal(raw: string): Decimal | null {
  let value = raw.trim().replace(SPACE_BETWEEN_DIGITS, "$1");
  const first = stripCurrency(value);
  value = first.value;
  // The sign is read before anything else so negatives get their own report code.
  const negative = value.startsWith("-");
  if (negative) value = value.slice(1).trim();
  if (!first.stripped) value = stripCurrency(value).value;

  if (!/^[0-9.,]+$/.test(value) || !/[0-9]/.test(value)) return null;

  const dots = value.split(".").length - 1;
  const commas = value.split(",").length - 1;
  let integer = value;
  let fraction = "";

  if (dots > 0 && commas > 0) {
    const decimalChar = value.lastIndexOf(".") > value.lastIndexOf(",") ? "." : ",";
    if ((decimalChar === "." ? dots : commas) > 1) return null; // repeated decimal separator
    const parts = value.split(decimalChar === "." ? "," : ".").join("").split(decimalChar);
    integer = parts[0];
    fraction = parts[1] ?? "";
  } else if (dots + commas > 0) {
    const parts = value.split(dots > 0 ? "." : ",");
    const groups = parts.slice(1);
    if (groups.length > 1) {
      // Repeated single separator: thousands, so every group but the first is exactly 3 digits.
      if (parts[0].length === 0 || parts[0].length > 3) return null;
      if (groups.some((group) => group.length !== 3)) return null;
      integer = parts.join("");
    } else if (parts[0].length > 0 && groups[0].length === 3) {
      integer = parts.join(""); // "1,234" is one thousand two hundred thirty four
    } else {
      integer = parts[0];
      fraction = groups[0];
    }
  }

  if (!/^[0-9]*$/.test(integer) || !/^[0-9]*$/.test(fraction)) return null;
  if (integer.length === 0 && fraction.length === 0) return null;
  return { negative, integer, fraction };
}

export function parsePrice(raw: string): NumberResult {
  const parsed = parseDecimal(raw);
  if (parsed === null) return { ok: false, error: "invalid" };
  if (parsed.fraction.length > 2) return { ok: false, error: "precision" };
  const cents = Number(parsed.integer || "0") * 100 + Number(parsed.fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > PRICE_MAX_CENTS) {
    return { ok: false, error: "out_of_range" };
  }
  if (parsed.negative && cents > 0) return { ok: false, error: "negative" };
  return { ok: true, value: cents };
}

export function parseStock(raw: string): NumberResult {
  const parsed = parseDecimal(raw);
  if (parsed === null) return { ok: false, error: "invalid" };
  // "12.00" is still twelve units; anything else after the separator is not an integer.
  if (/[1-9]/.test(parsed.fraction)) return { ok: false, error: "invalid" };
  const value = Number(parsed.integer || "0");
  if (!Number.isSafeInteger(value) || value > STOCK_MAX) return { ok: false, error: "out_of_range" };
  if (parsed.negative && value > 0) return { ok: false, error: "negative" };
  return { ok: true, value };
}
