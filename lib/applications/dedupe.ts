export type IdentityInput = {
  companyName: string;
  title: string;
  applicationUrl: string;
  externalId?: string | null;
  location?: string | null;
};

export function applicationIdentity(input: IdentityInput) {
  const url = normalizeUrl(input.applicationUrl);
  if (url) return `url:${url}`;
  if (input.externalId) return `external:${normalize(input.companyName)}:${input.externalId.trim()}`;
  return `title:${normalize(input.companyName)}:${normalize(input.title)}:${normalize(input.location ?? "")}`;
}

export function sameVacancy(left: IdentityInput, right: IdentityInput) {
  if (applicationIdentity(left) === applicationIdentity(right)) return true;
  return normalize(left.companyName) === normalize(right.companyName)
    && normalize(left.title) === normalize(right.title)
    && normalize(left.location ?? "") === normalize(right.location ?? "");
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
