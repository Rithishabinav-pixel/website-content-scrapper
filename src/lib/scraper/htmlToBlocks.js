/**
 * Deterministic DOM -> block-model walker.
 *
 * No text is ever generated, reworded, or trimmed here — every character
 * of text content is copied verbatim into "runs". Only structural HTML
 * elements (headings, paragraphs, lists, links, emphasis, tables,
 * blockquotes) are mapped to block/run types; everything else (script,
 * style, media, form controls, etc.) is skipped entirely.
 */

const SKIPPED_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "img",
  "picture",
  "video",
  "audio",
  "source",
  "track",
  "canvas",
  "button",
  "input",
  "select",
  "textarea",
  "form",
  "object",
  "embed",
  "template",
  "nav",
  "header",
  "footer",
  "aside",
  "figure",
  "figcaption",
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function collapseWhitespace(text) {
  // Collapse HTML's insignificant whitespace/newlines the same way a
  // browser would when rendering, without altering the actual words.
  return text.replace(/[ \t\r\n\f]+/g, " ");
}

/**
 * Walks inline content (text, <b>/<strong>, <i>/<em>, <a>, <br>, <code>)
 * within a block-level element and returns a flat list of "runs".
 */
function extractRuns(node, formatting) {
  const runs = [];

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      // Text node
      const text = collapseWhitespace(child.textContent);
      if (text.length > 0) runs.push({ text, ...formatting });
      continue;
    }
    if (child.nodeType !== 1) continue; // skip comments etc.

    const tag = child.tagName.toLowerCase();
    if (SKIPPED_TAGS.has(tag)) continue;

    if (tag === "br") {
      runs.push({ text: "\n", ...formatting });
      continue;
    }

    if (tag === "a") {
      const href = child.getAttribute("href") || null;
      runs.push(...extractRuns(child, { ...formatting, link: href }));
      continue;
    }

    if (tag === "strong" || tag === "b") {
      runs.push(...extractRuns(child, { ...formatting, bold: true }));
      continue;
    }

    if (tag === "em" || tag === "i") {
      runs.push(...extractRuns(child, { ...formatting, italic: true }));
      continue;
    }

    if (tag === "code" || tag === "kbd" || tag === "samp") {
      runs.push(...extractRuns(child, { ...formatting, code: true }));
      continue;
    }

    if (tag === "u") {
      runs.push(...extractRuns(child, { ...formatting, underline: true }));
      continue;
    }

    if (tag === "s" || tag === "strike" || tag === "del") {
      runs.push(...extractRuns(child, { ...formatting, strike: true }));
      continue;
    }

    // Any other inline-ish wrapper (span, small, mark, sub, sup, abbr, etc.):
    // recurse without adding formatting so its text is still preserved.
    runs.push(...extractRuns(child, formatting));
  }

  return runs;
}

function runsHaveText(runs) {
  return runs.some((r) => r.text.trim().length > 0);
}

function buildListBlock(listEl, ordered) {
  const items = [];
  for (const child of Array.from(listEl.children)) {
    if (child.tagName.toLowerCase() !== "li") continue;
    items.push(buildListItem(child));
  }
  return { type: "list", ordered, items };
}

function buildListItem(liEl) {
  // An <li> may contain inline text plus nested <ul>/<ol> children. We
  // separate the item's own text runs from any nested sub-lists so the
  // DOCX generator can render proper nested bullet/number levels.
  const runs = [];
  const nestedLists = [];

  for (const child of Array.from(liEl.childNodes)) {
    if (child.nodeType === 1 && (child.tagName.toLowerCase() === "ul" || child.tagName.toLowerCase() === "ol")) {
      nestedLists.push(buildListBlock(child, child.tagName.toLowerCase() === "ol"));
      continue;
    }
    if (child.nodeType === 3) {
      const text = collapseWhitespace(child.textContent);
      if (text.length > 0) runs.push({ text });
      continue;
    }
    if (child.nodeType === 1) {
      const tag = child.tagName.toLowerCase();
      if (SKIPPED_TAGS.has(tag)) continue;
      runs.push(...extractRuns(child, {}));
    }
  }

  return { runs, nested: nestedLists };
}

function buildTableBlock(tableEl) {
  const rows = [];
  const rowEls = tableEl.querySelectorAll ? tableEl.querySelectorAll("tr") : [];
  for (const rowEl of Array.from(rowEls)) {
    const cells = [];
    for (const cellEl of Array.from(rowEl.children)) {
      const tag = cellEl.tagName.toLowerCase();
      if (tag !== "td" && tag !== "th") continue;
      const runs = extractRuns(cellEl, {});
      cells.push({ runs, isHeader: tag === "th" });
    }
    if (cells.length > 0) rows.push(cells);
  }
  return { type: "table", rows };
}

/**
 * Converts a root DOM element's descendants into an ordered array of
 * blocks. Recurses into generic containers (div/section/etc.) so content
 * is found regardless of the wrapper markup used around it.
 */
export function domToBlocks(rootEl) {
  const blocks = [];

  function walk(node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (SKIPPED_TAGS.has(tag)) continue;

      if (HEADING_TAGS.has(tag)) {
        const runs = extractRuns(child, {});
        if (runsHaveText(runs)) {
          blocks.push({ type: "heading", level: Number(tag[1]), runs });
        }
        continue;
      }

      if (tag === "p") {
        const runs = extractRuns(child, {});
        if (runsHaveText(runs)) {
          blocks.push({ type: "paragraph", runs });
        }
        continue;
      }

      if (tag === "ul" || tag === "ol") {
        const listBlock = buildListBlock(child, tag === "ol");
        if (listBlock.items.length > 0) blocks.push(listBlock);
        continue;
      }

      if (tag === "blockquote") {
        const innerBlocks = [];
        const before = blocks.length;
        walk(child);
        const extracted = blocks.splice(before);
        if (extracted.length === 0) {
          const runs = extractRuns(child, {});
          if (runsHaveText(runs)) innerBlocks.push({ type: "paragraph", runs });
        } else {
          innerBlocks.push(...extracted);
        }
        if (innerBlocks.length > 0) blocks.push({ type: "blockquote", blocks: innerBlocks });
        continue;
      }

      if (tag === "table") {
        const tableBlock = buildTableBlock(child);
        if (tableBlock.rows.length > 0) blocks.push(tableBlock);
        continue;
      }

      if (tag === "pre") {
        const text = child.textContent.replace(/\r\n/g, "\n");
        if (text.trim().length > 0) {
          blocks.push({ type: "paragraph", runs: [{ text, code: true }] });
        }
        continue;
      }

      if (tag === "hr") {
        blocks.push({ type: "divider" });
        continue;
      }

      // Generic container: recurse to find nested block content.
      walk(child);
    }
  }

  walk(rootEl);
  return blocks;
}
