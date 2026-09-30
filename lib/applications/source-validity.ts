export type SourceValidity = "VALID_VACANCY" | "INVALID_SOURCE";

const LISTING_HOST = /(?:^|\.)(?:indeed|linkedin|ziprecruiter|glassdoor|hellowork|welcometothejungle|simplyhired|monster|jooble|talent|weworkremotely|apmlist|productmanagerjobboard|mindtheproduct)\./i;

export function sourceValidity(input: { title: string; url: string; source?: string }): SourceValidity {
  if (isSpecificPosting(input.url)) return "VALID_VACANCY";
  if (isListingUrl(input.url) || isListingTitle(input.title)) return "INVALID_SOURCE";
  if ((input.source ?? "").toLowerCase() === "generic" && isListingTitle(input.title)) return "INVALID_SOURCE";
  return "VALID_VACANCY";
}

function isSpecificPosting(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  if (host.endsWith("greenhouse.io") && /\/jobs\/\d+/.test(path)) return true;
  if (host.endsWith("lever.co") && /^\/[^/]+\/[0-9a-f-]{8,}/i.test(path)) return true;
  if (host.endsWith("ashbyhq.com") && path.split("/").filter(Boolean).length >= 2) return true;
  if (host.endsWith("workable.com") && /\/j\/[^/]+/.test(path)) return true;
  if (host.endsWith("smartrecruiters.com") && path.split("/").filter(Boolean).length >= 2) return true;
  return false;
}

function isListingUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  const host = parsed.hostname.toLowerCase();
  const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
  if (LISTING_HOST.test(host) && !/\/jobs\/view\/\d+|\/viewjob|jk=/.test(path)) return true;
  if (/\/(?:search|job-search|jobs\/search|browse)(?:\/|$|\?)/.test(path)) return true;
  if (/[?&](?:q|query|search|keywords|k)=/.test(path)) return true;
  return false;
}

function isListingTitle(title: string) {
  const text = title.replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/\d[\d,.]*\+?\s+\S{0,40}\b(?:jobs|offres|openings|roles)\b/i.test(text)) return true;
  if (/\b(?:job list|job board|jobs board|offres d['’]emploi|now hiring)\b/i.test(text)) return true;
  if (/\b(?:jobs|roles|openings)\s+in\b/i.test(text)) return true;
  if (/\b(?:roles|jobs)\s+at\b/i.test(text)) return true;
  if (/\|\s*(?:indeed|linkedin|ziprecruiter|glassdoor|hellowork)\b/i.test(text)) return true;
  if (/\b(?:start here|find pm jobs|find .* jobs)\b/i.test(text)) return true;
  if (/\bcareers\b/i.test(text) && !/\b(?:senior|staff|principal|lead|head|director|manager|engineer|developer|architect|analyst)\b/i.test(text)) return true;
  return false;
}
