import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import { isIpBlocked, isHostnameObviouslyBlocked, isUrlSchemeAllowed, stripBrackets } from "./ssrf";
import { ScraperError, ErrorCodes } from "./errors";

const REQUEST_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8MB cap per page
const USER_AGENT = "Mozilla/5.0 (compatible; WebsiteContentScraper/1.0; +https://example.com/bot)";

/**
 * Custom `dns.lookup` replacement passed straight into http(s).request.
 * Node uses the address this returns to open the TCP socket, so validating
 * here (rather than only validating the hostname up front) closes the
 * DNS-rebinding gap: the address that's actually dialed is the one that's
 * checked against the SSRF block-list.
 */
function createSafeLookup() {
  return function safeLookup(hostname, options, callback) {
    dns.lookup(stripBrackets(hostname), { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses || addresses.length === 0) {
        return callback(new Error("DNS lookup returned no addresses"));
      }
      const blocked = addresses.find((a) => isIpBlocked(a.address));
      if (blocked) {
        return callback(new Error(`SSRF_BLOCKED:${blocked.address}`));
      }
      // Node's Happy Eyeballs (autoSelectFamily, on by default) calls
      // custom lookups with `options.all: true` and expects the full
      // address list back; without this branch it misreads a single
      // {address, family} pair as a broken address list.
      if (options && options.all) {
        return callback(null, addresses);
      }
      const chosen = addresses[0];
      callback(null, chosen.address, chosen.family);
    });
  };
}

function requestOnce(parsedUrl) {
  return new Promise((resolve, reject) => {
    const transport = parsedUrl.protocol === "https:" ? https : http;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const req = transport.request(
      parsedUrl,
      {
        method: "GET",
        signal: controller.signal,
        lookup: createSafeLookup(),
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        const chunks = [];
        let receivedBytes = 0;

        res.on("data", (chunk) => {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            req.destroy();
            reject(new ScraperError(ErrorCodes.RESPONSE_TOO_LARGE, "The page response exceeded the maximum allowed size."));
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          clearTimeout(timer);
          if (receivedBytes > MAX_RESPONSE_BYTES) return; // already rejected above
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      }
    );

    req.on("error", (err) => {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        reject(new ScraperError(ErrorCodes.TIMEOUT, "The request timed out while fetching the page."));
        return;
      }
      if (typeof err.message === "string" && err.message.startsWith("SSRF_BLOCKED")) {
        reject(new ScraperError(ErrorCodes.BLOCKED_HOST, "This URL resolves to a private or restricted network address and cannot be scraped."));
        return;
      }
      reject(new ScraperError(ErrorCodes.NETWORK_ERROR, "The network request failed."));
    });

    req.end();
  });
}

/**
 * Fetches an HTML page, following redirects manually so each hop is
 * re-validated against the SSRF rules before being followed.
 */
export async function fetchPage(targetUrl) {
  let currentUrl = targetUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    let parsedUrl;
    try {
      parsedUrl = new URL(currentUrl);
    } catch {
      throw new ScraperError(ErrorCodes.INVALID_URL, "The URL is not valid.");
    }

    if (!isUrlSchemeAllowed(parsedUrl)) {
      throw new ScraperError(ErrorCodes.INVALID_URL, "Only HTTP and HTTPS URLs are supported.");
    }
    if (isHostnameObviouslyBlocked(parsedUrl.hostname)) {
      throw new ScraperError(ErrorCodes.BLOCKED_HOST, "This host is not allowed to be scraped.");
    }

    const response = await requestOnce(parsedUrl);

    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      if (!location) {
        throw new ScraperError(ErrorCodes.NETWORK_ERROR, "The server sent a redirect without a destination.");
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new ScraperError(ErrorCodes.PAGE_UNAVAILABLE, `The page responded with status ${response.statusCode}.`);
    }

    const contentType = response.headers["content-type"] || "";
    if (!contentType.includes("html") && !contentType.includes("xml")) {
      throw new ScraperError(ErrorCodes.UNSUPPORTED_CONTENT, "The URL did not return an HTML page.");
    }

    return { html: response.body, finalUrl: currentUrl };
  }

  throw new ScraperError(ErrorCodes.TOO_MANY_REDIRECTS, "Too many redirects were encountered while fetching the page.");
}
