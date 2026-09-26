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

const BLOCKED_IPS = new Set(["207.180.248.233"]);

export function isBlockedIp(address: string) {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_IPS.has(ip)) return true;
  if (ip === "::1" || ip === "0.0.0.0" || ip === "::") return true;
  if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) {
    return true;
  }
  if (ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  const v4 = ip.match(/^(\d+)\.(\d+)\./);
  if (v4) {
    const first = Number(v4[1]);
    const second = Number(v4[2]);
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 100 && second >= 64 && second <= 127) return true;
    if (first === 0) return true;
  }
  return false;
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
  if (isIP(url.hostname)) return url;
  const records = await dnsLookup(url.hostname);
  if (records.length === 0) throw new AppError("The website address could not be resolved.");
  if (records.some((address) => isBlockedIp(address))) {
    throw new AppError("That website resolves to a private network address.");
  }
  return url;
}

async function dnsLookup(hostname: string) {
  const dns = await import("node:dns/promises");
  const records = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
  const addresses: string[] = [];
  for (const record of records) {
    if (record.status === "fulfilled") addresses.push(...record.value);
  }
  return addresses;
}
