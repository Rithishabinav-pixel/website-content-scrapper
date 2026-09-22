/**
 * Typed error used throughout the scraper pipeline so the API route can
 * report a stable `code` + user-safe `message` without leaking internals.
 */
export class ScraperError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ScraperError";
    this.code = code;
  }
}

export const ErrorCodes = {
  INVALID_URL: "INVALID_URL",
  BLOCKED_HOST: "BLOCKED_HOST",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  PAGE_UNAVAILABLE: "PAGE_UNAVAILABLE",
  TOO_MANY_REDIRECTS: "TOO_MANY_REDIRECTS",
  RESPONSE_TOO_LARGE: "RESPONSE_TOO_LARGE",
  UNSUPPORTED_CONTENT: "UNSUPPORTED_CONTENT",
  EXTRACTION_FAILED: "EXTRACTION_FAILED",
  DOCX_GENERATION_FAILED: "DOCX_GENERATION_FAILED",
  DUPLICATE_URL: "DUPLICATE_URL",
  UNEXPECTED_ERROR: "UNEXPECTED_ERROR",
};
