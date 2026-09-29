export type WorkMode = {
  remoteType: "remote" | "hybrid" | "on-site" | null;
  geographicRestriction: string | null;
};

export function normalizeWorkMode(location: string | null | undefined): WorkMode {
  const raw = (location ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { remoteType: null, geographicRestriction: null };
  const lower = raw.toLowerCase();
  if (/hybrid/.test(lower)) return { remoteType: "hybrid", geographicRestriction: raw };
  if (/on-?site|onsite|in[- ]office/.test(lower)) return { remoteType: "on-site", geographicRestriction: raw };
  if (/worldwide|anywhere|global/.test(lower) && !/remote/.test(lower)) {
    return { remoteType: "remote", geographicRestriction: "worldwide" };
  }
  if (/remote/.test(lower)) {
    const restriction = raw.replace(/remote/gi, " ").replace(/[,;|]+/g, " ").replace(/\s+/g, " ").trim();
    return { remoteType: "remote", geographicRestriction: restriction || raw };
  }
  return { remoteType: null, geographicRestriction: raw };
}

export function canonicalApplicationUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return value.trim();
  }
}
