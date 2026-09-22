import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { domToBlocks } from "./htmlToBlocks";
import { ScraperError, ErrorCodes } from "./errors";

const JUNK_SELECTOR = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '[aria-hidden="true"]',
].join(",");

// Matched against class/id tokens to strip layout chrome that isn't
// captured by the semantic selectors above (cookie banners, share
// widgets, related-posts blocks, etc.) before heuristic scoring runs.
const JUNK_PATTERN =
  /(^|[-_ ])(nav|menu|sidebar|footer|header|advert(is(ing|ement))?|ads?|banner|cookie|consent|gdpr|newsletter|subscri\w*|social|share|sharing|comment\w*|related|recommend\w*|promo\w*|popup|modal|breadcrumb\w*|pagination|widget|masthead|skip-link|site-header|site-footer)([-_ ]|$)/i;

function collapse(text) {
  return text.replace(/\s+/g, " ").trim();
}

function stripJunk(document) {
  document.querySelectorAll(JUNK_SELECTOR).forEach((el) => el.remove());
  document.querySelectorAll("[class], [id]").forEach((el) => {
    const cls = el.getAttribute("class") || "";
    const id = el.getAttribute("id") || "";
    if (JUNK_PATTERN.test(cls) || JUNK_PATTERN.test(id)) {
      el.remove();
    }
  });
}

/**
 * Text-density heuristic used only when Readability can't confidently
 * find an article. Rewards elements with lots of paragraph/heading text
 * and penalizes ones dominated by link text (typical of nav/list widgets).
 */
function scoreElement(el) {
  const textLength = collapse(el.textContent || "").length;
  if (textLength < 40) return -1;
  const linkTextLength = Array.from(el.querySelectorAll("a")).reduce((sum, a) => sum + collapse(a.textContent || "").length, 0);
  const linkDensity = textLength === 0 ? 1 : Math.min(linkTextLength / textLength, 1);
  const paragraphCount = el.querySelectorAll("p").length;
  const headingCount = el.querySelectorAll("h1, h2, h3, h4, h5, h6").length;

  let score = textLength * (1 - linkDensity * 0.9);
  score += paragraphCount * 25;
  score += headingCount * 10;
  return score;
}

function pickHeuristicRoot(document) {
  stripJunk(document);
  const candidates = Array.from(document.querySelectorAll('main, article, [role="main"], section, div'));
  let best = document.body;
  let bestScore = document.body ? scoreElement(document.body) : -1;
  for (const el of candidates) {
    const score = scoreElement(el);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/**
 * Extracts the main content of a page as an ordered block model.
 *
 * Strategy (in order):
 *  1. @mozilla/readability — the same deterministic extraction algorithm
 *     used by Firefox Reader View. It removes chrome (nav/ads/sidebars)
 *     while keeping the article's HTML structure (headings, lists, links,
 *     emphasis) intact, so nothing is reworded or summarized.
 *  2. Semantic/density fallback — for pages Readability can't confidently
 *     parse (e.g. no clear article, heavily templated pages), pick the
 *     highest text-density candidate among <main>/<article>/<section>/<div>
 *     after stripping obvious chrome by tag, role, and class/id keywords.
 *
 * Both paths only ever copy existing DOM text into the block model
 * (see htmlToBlocks.js) — neither path rewrites or shortens text.
 */
export function extractMainContent(html, url) {
  let readabilityArticle = null;
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document, { keepClasses: false });
    const article = reader.parse();
    if (article && article.content && collapse(article.textContent || "").length > 200) {
      readabilityArticle = article;
    }
  } catch {
    readabilityArticle = null;
  }

  if (readabilityArticle) {
    const contentDom = new JSDOM(readabilityArticle.content);
    const blocks = domToBlocks(contentDom.window.document.body);
    if (blocks.length > 0) {
      return {
        title: readabilityArticle.title ? collapse(readabilityArticle.title) : null,
        blocks,
        method: "readability",
      };
    }
  }

  let dom;
  try {
    dom = new JSDOM(html, { url });
  } catch {
    throw new ScraperError(ErrorCodes.EXTRACTION_FAILED, "The page HTML could not be parsed.");
  }

  const document = dom.window.document;
  const titleEl = document.querySelector("title");
  const root = pickHeuristicRoot(document);
  const blocks = root ? domToBlocks(root) : [];

  if (blocks.length === 0) {
    throw new ScraperError(ErrorCodes.EXTRACTION_FAILED, "The main content of this page could not be reliably identified.");
  }

  return {
    title: titleEl ? collapse(titleEl.textContent) : null,
    blocks,
    method: "heuristic",
  };
}
