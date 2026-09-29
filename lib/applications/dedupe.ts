export type IdentityInput = {
  companyName: string;
  title: string;
  applicationUrl: string;
  sourceUrl?: string | null;
  externalId?: string | null;
  location?: string | null;
};

export function applicationIdentity(input: IdentityInput) {
  const url = normalizeUrl(input.applicationUrl);
  if (url) return `url:${url}`;
  if (input.externalId) return `external:${normalize(input.companyName)}:${input.externalId.trim()}`;
  return `title:${normalize(input.companyName)}:${normalize(input.title)}:${normalize(input.location ?? "")}`;
}

export function duplicateDecision(left: IdentityInput, right: IdentityInput) {
  const leftApplication = normalizeUrl(left.applicationUrl);
  const rightApplication = normalizeUrl(right.applicationUrl);
  if (leftApplication && leftApplication === rightApplication) return { merge: true, reason: "canonical application URL" };
  const leftSource = normalizeUrl(left.sourceUrl ?? "");
  const rightSource = normalizeUrl(right.sourceUrl ?? "");
  if (leftSource && leftSource === rightSource) return { merge: true, reason: "canonical job URL" };
  if (left.externalId && right.externalId && left.externalId.trim() === right.externalId.trim() && normalize(left.companyName) === normalize(right.companyName)) {
    return { merge: true, reason: "source job id" };
  }
  const sameText = normalize(left.companyName) === normalize(right.companyName)
    && normalize(left.title) === normalize(right.title)
    && normalize(left.location ?? "") !== ""
    && normalize(left.location ?? "") === normalize(right.location ?? "");
  const urlsDiffer = Boolean(leftApplication && rightApplication && leftApplication !== rightApplication);
  if (sameText && !urlsDiffer) return { merge: true, reason: "company, title, and location" };
  return { merge: false, reason: null as string | null };
}

export function sameVacancy(left: IdentityInput, right: IdentityInput) {
  return duplicateDecision(left, right).merge;
}

export function isDuplicateIdentity(existing: string[], next: string) {
  return existing.includes(next);
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    const path = url.pathname.replace(/\/$/, "");
    return `${url.hostname.toLowerCase()}${path}`.toLowerCase();
  } catch {
    return "";
  }
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
