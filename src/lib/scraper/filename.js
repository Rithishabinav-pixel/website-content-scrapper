/**
 * Safe, deterministic filename generation for the per-URL DOCX output.
 * Prefers the page title (matches what a user would expect), falling
 * back to the last URL path segment, then the hostname.
 */
function slugify(text) {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip accents
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "page"
  );
}

export function filenameForUrl(url, title) {
  if (title && title.trim().length > 0) {
    return slugify(title);
  }
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const lastSegment = segments.pop();
    return slugify(lastSegment || parsed.hostname);
  } catch {
    return "page";
  }
}

/**
 * Appends `-2`, `-3`, ... to avoid overwriting a name already used in
 * this batch, and reserves the returned name so later calls see it too.
 */
export function dedupeFilename(base, usedNames) {
  let candidate = `${base}.docx`;
  let counter = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}-${counter}.docx`;
    counter += 1;
  }
  usedNames.add(candidate);
  return candidate;
}
