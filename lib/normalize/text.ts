/** Text field rules from docs/architecture.md: NFC, control stripping, trim, length caps. */

/** Fields with a length cap; anything over the cap is rejected, never truncated. */
export const TEXT_LIMITS: Record<string, number | undefined> = {
  sku: 64,
  name: 256,
  category: 128,
  description: 8192,
  image_url: 2048,
};

// C0 and C1 controls except tab (0x09); newlines inside quoted cells go too.
// eslint-disable-next-line no-control-regex -- control regex is necessary for stripping controls
const CONTROLS = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g;

export const EXCERPT_MAX = 64;

export function normalizeText(raw: string): string {
  return raw.normalize("NFC").replace(CONTROLS, "").trim();
}

/** Report messages may echo cell content, so every value they carry is capped. */
export function excerpt(value: string, max: number = EXCERPT_MAX): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}
