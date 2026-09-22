import net from "node:net";

/**
 * SSRF guards: hostname allow-list rules plus IPv4/IPv6 range checks.
 * These are applied both to the URL's literal host and to every address
 * a hostname resolves to (see fetchPage.js), so DNS rebinding can't be
 * used to bypass the checks after the initial validation.
 */

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback", "metadata.google.internal"]);

// IPv4 ranges that must never be reached (loopback, private, link-local,
// CGNAT, documentation/test-net, multicast, reserved, and the cloud
// metadata address 169.254.169.254 which falls inside 169.254.0.0/16).
const BLOCKED_IPV4_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

function ipv4ToInt(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIpv4Blocked(ip) {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // fail closed on unparseable input
  return BLOCKED_IPV4_RANGES.some(([base, prefix]) => {
    const baseValue = ipv4ToInt(base);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (baseValue & mask);
  });
}

function expandIpv6(ip) {
  let [head, tail] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  if (!ip.includes("::")) {
    return ip.split(":").map((h) => parseInt(h || "0", 16));
  }
  const missing = 8 - headParts.length - tailParts.length;
  const zeros = new Array(Math.max(missing, 0)).fill(0);
  return [...headParts.map((h) => parseInt(h || "0", 16)), ...zeros, ...tailParts.map((h) => parseInt(h || "0", 16))];
}

function isIpv6Blocked(ip) {
  let groups;
  try {
    groups = expandIpv6(ip);
  } catch {
    return true;
  }
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return true;

  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96) addresses embed
  // an IPv4 address in the low 32 bits — validate that address instead.
  const isMapped = groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff;
  const isNat64 = groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0;
  if (isMapped || isNat64) {
    const embedded = `${(groups[6] >> 8) & 0xff}.${groups[6] & 0xff}.${(groups[7] >> 8) & 0xff}.${groups[7] & 0xff}`;
    return isIpv4Blocked(embedded);
  }

  const isLoopback = groups.every((g, i) => (i < 7 ? g === 0 : g === 1));
  const isUnspecified = groups.every((g) => g === 0);
  const isUniqueLocal = (groups[0] & 0xfe00) === 0xfc00; // fc00::/7
  const isLinkLocal = (groups[0] & 0xffc0) === 0xfe80; // fe80::/10
  const isDocumentation = groups[0] === 0x2001 && groups[1] === 0xdb8; // 2001:db8::/32

  return isLoopback || isUnspecified || isUniqueLocal || isLinkLocal || isDocumentation;
}

export function isIpBlocked(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isIpv4Blocked(ip);
  if (family === 6) return isIpv6Blocked(ip);
  return true; // not a valid IP at all — fail closed
}

// The WHATWG URL API keeps the [..] brackets in `.hostname` for IPv6
// literals (e.g. "[::1]"), but net.isIP/dns.lookup require the bare
// address, so callers must strip them before checking either.
export function stripBrackets(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function isHostnameObviouslyBlocked(hostname) {
  const lower = stripBrackets(hostname).toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith(".local")) return true;
  if (lower.endsWith(".internal")) return true;
  const literalFamily = net.isIP(lower);
  if (literalFamily) return isIpBlocked(lower);
  return false;
}

export function isUrlSchemeAllowed(parsedUrl) {
  return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
}
