import { fetchPage } from "@/lib/scraper/fetchPage";
import { extractMainContent } from "@/lib/scraper/extractMainContent";
import { generateDocxBuffer } from "@/lib/scraper/generateDocx";
import { filenameForUrl, dedupeFilename } from "@/lib/scraper/filename";
import { isValidHttpUrl, normalizeUrlForComparison } from "@/lib/scraper/validateUrl";
import { ScraperError, ErrorCodes } from "@/lib/scraper/errors";

// Route Handlers always run per-request in the Node runtime; scraping is
// inherently dynamic (external network I/O), so there's nothing to cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_URLS = 10;
const CONCURRENCY_LIMIT = 3;

function encodeEvent(event) {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

async function runWithConcurrency(items, limit, worker) {
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

/**
 * Streams newline-delimited JSON so the client can show live per-URL
 * progress instead of waiting for every URL to finish before showing
 * anything (see requirement: independent per-URL status reporting).
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const rawUrls = body?.urls;
  if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
    return Response.json({ error: "Provide at least one URL." }, { status: 400 });
  }
  if (rawUrls.length > MAX_URLS) {
    return Response.json({ error: `A maximum of ${MAX_URLS} URLs is allowed.` }, { status: 400 });
  }
  if (!rawUrls.every((u) => typeof u === "string")) {
    return Response.json({ error: "Each URL must be a string." }, { status: 400 });
  }

  const entries = rawUrls.map((raw, index) => ({ index, raw, trimmed: raw.trim(), error: null }));
  const seenNormalized = new Set();
  for (const entry of entries) {
    if (!entry.trimmed) {
      entry.error = { code: ErrorCodes.INVALID_URL, message: "URL cannot be empty." };
      continue;
    }
    if (!isValidHttpUrl(entry.trimmed)) {
      entry.error = { code: ErrorCodes.INVALID_URL, message: "This is not a valid HTTP or HTTPS URL." };
      continue;
    }
    const normalized = normalizeUrlForComparison(entry.trimmed);
    if (seenNormalized.has(normalized)) {
      entry.error = { code: ErrorCodes.DUPLICATE_URL, message: "This URL was already submitted in this batch." };
      continue;
    }
    seenNormalized.add(normalized);
  }

  const usedFilenames = new Set();

  const stream = new ReadableStream({
    async start(controller) {
      const invalidEntries = entries.filter((e) => e.error);
      for (const entry of invalidEntries) {
        controller.enqueue(
          encodeEvent({
            type: "result",
            index: entry.index,
            url: entry.raw,
            status: "error",
            code: entry.error.code,
            error: entry.error.message,
          })
        );
      }

      const pendingEntries = entries.filter((e) => !e.error);

      await runWithConcurrency(pendingEntries, CONCURRENCY_LIMIT, async (entry) => {
        controller.enqueue(encodeEvent({ type: "status", index: entry.index, url: entry.raw, status: "processing" }));

        try {
          const { html, finalUrl } = await fetchPage(entry.trimmed);
          const { title, blocks, method } = extractMainContent(html, finalUrl);
          const docxBuffer = await generateDocxBuffer({ title, sourceUrl: finalUrl, blocks });
          const filename = dedupeFilename(filenameForUrl(finalUrl, title), usedFilenames);

          controller.enqueue(
            encodeEvent({
              type: "result",
              index: entry.index,
              url: entry.raw,
              status: "success",
              filename,
              title,
              extractionMethod: method,
              docxBase64: docxBuffer.toString("base64"),
            })
          );
        } catch (err) {
          const scraperError =
            err instanceof ScraperError
              ? err
              : new ScraperError(ErrorCodes.UNEXPECTED_ERROR, "An unexpected error occurred while processing this URL.");
          if (!(err instanceof ScraperError)) {
            console.error(`[scraper] unexpected error for ${entry.trimmed}:`, err);
          }
          controller.enqueue(
            encodeEvent({
              type: "result",
              index: entry.index,
              url: entry.raw,
              status: "error",
              code: scraperError.code,
              error: scraperError.message,
            })
          );
        }
      });

      controller.enqueue(encodeEvent({ type: "done" }));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
