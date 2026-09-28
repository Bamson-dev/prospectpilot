import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { AppError } from "@/lib/errors";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.internal",
  "host.docker.internal",
  "coolify.leadpilot.live",
]);

const MAX_BODY = 1_500_000;
const MAX_REDIRECTS = 3;

export function isBlockedIp(address: string) {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "").split("%", 1)[0] ?? "";
  const mapped = ipv4FromMapped(ip);
  if (mapped) return isBlockedIp(mapped);
  if (isIP(ip) === 4) return blockedV4(ip);
  if (isIP(ip) === 6) return blockedV6(ip);
  return false;
}

function ipv4FromMapped(ip: string) {
  const dotted = ip.match(/^(?:0:){5}ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = Number.parseInt(hex[1] ?? "", 16);
  const low = Number.parseInt(hex[2] ?? "", 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function blockedV4(ip: string) {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = parts;
  if (first === undefined || second === undefined) return true;
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 192 && second === 0 && parts[2] === 0) return true;
  if (first === 192 && second === 0 && parts[2] === 2) return true;
  if (first === 192 && second === 88 && parts[2] === 99) return true;
  if (first === 198 && (second === 18 || second === 19)) return true;
  if (first === 198 && second === 51 && parts[2] === 100) return true;
  if (first === 203 && second === 0 && parts[2] === 113) return true;
  if (first >= 224) return true;
  return false;
}

function blockedV6(ip: string) {
  const groups = expandIpv6(ip);
  if (!groups) return true;
  if (groups.every((group) => group === 0)) return true;
  if (groups[7] === 1 && groups.slice(0, 7).every((group) => group === 0)) return true;
  const head = groups[0] ?? 0;
  // Only global unicast (2000::/3) is eligible. This excludes compatible,
  // translation, unique-local, link-local, and other special-use ranges.
  if (head < 0x2000 || head > 0x3fff) return true;
  // IETF protocol assignments (including documentation, Teredo, and ORCHID)
  // occupy 2001::/23 and are not general public destinations.
  if (head === 0x2001 && ((groups[1] ?? 0) <= 0x01ff || groups[1] === 0x0db8)) return true;
  // 6to4 embeds IPv4 destinations and must not bypass the IPv4 policy.
  if (head === 0x2002) return true;
  if (head >= 0xfe80 && head <= 0xfebf) return true;
  if (head >= 0xfec0 && head <= 0xfeff) return true;
  if ((head & 0xfe00) === 0xfc00) return true;
  return false;
}

function expandIpv6(ip: string) {
  if (ip.split("::").length > 2) return null;
  const sides = ip.split("::");
  const parse = (part: string) => (part ? part.split(":").map((group) => Number.parseInt(group, 16)) : []);
  const head = parse(sides[0] ?? "");
  const tail = sides.length === 1 ? [] : parse(sides[1] ?? "");
  if ([...head, ...tail].some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null;
  if (sides.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

export function selectPublicAddresses(addresses: string[]) {
  if (addresses.length === 0) throw new AppError("The website address could not be resolved.");
  if (addresses.some((address) => isBlockedIp(address))) {
    throw new AppError("That website resolves to a private network address.");
  }
  return addresses;
}

export function assertSafeResearchUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError("That website address is not valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("Only public http and https websites can be researched.");
  }
  if (url.username || url.password) throw new AppError("Website addresses cannot include credentials.");
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new AppError("Research is limited to standard web ports.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new AppError("That address is not a public website.");
  }
  if (isIP(host) && isBlockedIp(host)) throw new AppError("That address is not a public website.");
  return url;
}

export async function assertResolvedPublicUrl(input: string) {
  const url = assertSafeResearchUrl(input);
  if (isIP(url.hostname)) {
    selectPublicAddresses([url.hostname]);
    return url;
  }
  selectPublicAddresses(await resolvePublicHost(url.hostname));
  return url;
}

export type PinnedResponse = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

export type PublicFetchDeps = {
  resolve?: (hostname: string) => Promise<string[]>;
  exchange?: (input: { url: URL; address: string }) => Promise<Omit<PinnedResponse, "url">>;
};

export async function fetchPublic(input: string, deps: PublicFetchDeps = {}, hops = 0): Promise<PinnedResponse> {
  if (hops > MAX_REDIRECTS) throw new AppError("The website redirected too many times.");
  const url = assertSafeResearchUrl(input);
  const addresses = isIP(url.hostname)
    ? selectPublicAddresses([url.hostname])
    : selectPublicAddresses(await (deps.resolve ?? resolvePublicHost)(url.hostname));
  const address = addresses[0];
  if (!address) throw new AppError("The website address could not be resolved.");
  const response = await (deps.exchange ?? exchangePinned)({ url, address });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.location;
    if (!location) throw new AppError("The website redirected without a destination.");
    return fetchPublic(new URL(location, url).toString(), deps, hops + 1);
  }
  return { url: url.toString(), ...response };
}

export function exchangePinned(input: { url: URL; address: string }) {
  selectPublicAddresses([input.address]);
  const lib = input.url.protocol === "https:" ? https : http;
  const family = isIP(input.address) === 6 ? 6 : 4;
  return new Promise<Omit<PinnedResponse, "url">>((resolve, reject) => {
    const request = lib.request(
      input.url,
      {
        method: "GET",
        headers: {
          Host: input.url.host,
          "User-Agent": "ProspectPilotResearch/0.1",
          Accept: "*/*",
          "Accept-Encoding": "identity",
        },
        servername: input.url.hostname,
        lookup: (_hostname, options, callback) => {
          const done = typeof options === "function" ? options : callback;
          if (typeof options === "object" && options?.all) {
            done(null, [{ address: input.address, family }]);
            return;
          }
          done(null, input.address, family);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY) {
            response.destroy();
            reject(new AppError("The website response was too large."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === "string") headers[key.toLowerCase()] = value;
            else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(", ");
          }
          resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks) });
        });
      },
    );
    request.setTimeout(12000, () => request.destroy(new Error("timeout")));
    request.on("error", () => reject(new AppError("The website could not be reached.")));
    request.end();
  });
}

async function resolvePublicHost(hostname: string) {
  const dns = await import("node:dns/promises");
  const records = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
  const addresses: string[] = [];
  for (const record of records) {
    if (record.status === "fulfilled") addresses.push(...record.value);
  }
  return addresses;
}
