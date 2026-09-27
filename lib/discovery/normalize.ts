import { registrableHost, websiteFromUrl } from "@/lib/domains";

const LISTING_PORTALS = [
  "property24.com",
  "privateproperty.co.za",
  "gumtree.co.za",
  "olx.co.za",
  "yellowpages.co.za",
  "yelp.com",
];

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]\d{3,4}/g;

export function isListingPortal(domain: string) {
  const host = domain.toLowerCase().replace(/^www\./, "");
  return LISTING_PORTALS.some((portal) => host === portal || host.endsWith(`.${portal}`));
}

export function canonicalDomain(input: string | null | undefined) {
  return websiteFromUrl(input ?? "")?.domain ?? registrableHost(input);
}

export function sameCompany(left: { domain?: string | null; website?: string | null }, right: { domain?: string | null; website?: string | null }) {
  const leftDomain = canonicalDomain(left.domain || left.website);
  const rightDomain = canonicalDomain(right.domain || right.website);
  return Boolean(leftDomain && rightDomain && leftDomain === rightDomain);
}

export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase().replace(/^mailto:/, "");
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return null;
  if (/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(email)) return null;
  if (email.includes("example.com") || email.includes("sentry") || email.includes("wixpress")) return null;
  const [local] = email.split("@");
  if (!local || local.length < 2 || local.includes("..")) return null;
  return email;
}

export function extractEmails(text: string) {
  const found = text.match(EMAIL) ?? [];
  return [...new Set(found.map((item) => normalizeEmail(item)).filter((item): item is string => Boolean(item)))];
}

export function normalizePhone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 9) return null;
  return digits;
}

export function extractPhones(text: string) {
  const found = text.match(PHONE) ?? [];
  return [...new Set(found.map((item) => normalizePhone(item)).filter((item): item is string => Boolean(item)))];
}

export function dedupeQueries(queries: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const query of queries) {
    const key = query.toLowerCase().replace(/\s+/g, " ").trim();
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    unique.push(query.replace(/\s+/g, " ").trim());
  }
  return unique;
}
