/**
 * Pure, environment-agnostic URL format check shared by the client form
 * and the API route. It only checks shape (http/https + parseable) —
 * SSRF/private-network checks live server-side in ssrf.js, since a
 * malicious client could bypass client-side validation entirely.
 */
export function isValidHttpUrl(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export function normalizeUrlForComparison(value) {
  return value.trim().toLowerCase();
}
