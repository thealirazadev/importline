/** URL field rules from docs/architecture.md: absolute http/https URL only. */

export type UrlError = "invalid";
export type UrlResult = { ok: true; value: string } | { ok: false; error: UrlError };

const ABSOLUTE_URL = /^https?:\/\/.{1,}/i;

export function normalizeUrl(raw: string): UrlResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: "" };
  if (!ABSOLUTE_URL.test(trimmed)) {
    return { ok: false, error: "invalid" };
  }
  return { ok: true, value: trimmed };
}
