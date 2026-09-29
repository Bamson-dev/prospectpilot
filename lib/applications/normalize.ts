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

export function interpretLocation(text: string | null | undefined) {
  const mode = normalizeWorkMode(text);
  const lower = (text ?? "").toLowerCase();
  let eligibleRegion = mode.geographicRestriction;
  if (/united states only|\bus only\b|\busa only\b|remote us\b/.test(lower)) eligibleRegion = "US";
  else if (/europe only|remote europe/.test(lower)) eligibleRegion = "Europe";
  else if (/anywhere|worldwide|globally/.test(lower)) eligibleRegion = "worldwide";
  return { remote: mode.remoteType === "remote", hybrid: mode.remoteType === "hybrid", onSite: mode.remoteType === "on-site", eligibleRegion };
}

export function locationSatisfied(candidateLocation: string | null | undefined, text: string) {
  const rule = interpretLocation(text);
  if (!rule.eligibleRegion || rule.eligibleRegion === "worldwide") return candidateLocation?.trim() ? "SATISFIED" as const : "UNKNOWN" as const;
  if (!candidateLocation?.trim()) return "UNKNOWN" as const;
  const location = candidateLocation.toLowerCase();
  if (rule.eligibleRegion === "US") return /\bunited states\b|\busa\b|\bu\.s\.?\b/.test(location) ? "SATISFIED" as const : "FLAG" as const;
  if (location.includes(rule.eligibleRegion.toLowerCase())) return "SATISFIED" as const;
  return "FLAG" as const;
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
