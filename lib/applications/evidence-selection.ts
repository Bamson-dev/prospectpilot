export type MatchType = "DIRECT" | "TRANSFERABLE" | "UNCERTAIN" | "MISSING";

export type EvidenceSelection = {
  requirement: string;
  evidence: string | null;
  source: string | null;
  match: MatchType;
  confidence: number;
  reason: string;
};

type EvidenceFact = {
  fact: string;
  source?: string | null;
  category?: string | null;
  technologies?: string[];
  skills?: string[];
};

export function selectEvidence(requirement: string, facts: EvidenceFact[]): EvidenceSelection {
  const text = requirement.trim();
  if (/\d+\s*(?:years|yrs)/i.test(text) && !facts.some((fact) => /\d+\s*(?:years|yrs)/i.test(fact.fact))) {
    return { requirement: text, evidence: null, source: null, match: "UNCERTAIN", confidence: 0.4, reason: "The requirement asks for a duration, and no verified duration is on file." };
  }
  const wanted = technologyName(text);
  if (wanted) {
    const exact = facts.find((fact) => names(fact).some((name) => sameTechnology(name, wanted)));
    if (exact) return { requirement: text, evidence: exact.fact, source: exact.source ?? null, match: "DIRECT", confidence: 0.95, reason: "Verified evidence names this technology." };
    return { requirement: text, evidence: null, source: null, match: "MISSING", confidence: 0.9, reason: "No verified evidence names this technology. A different technology is not treated as the same skill." };
  }
  const explained = facts.find((fact) => /transferable to/i.test(fact.fact) && sharesToken(text, fact.fact));
  if (explained) return { requirement: text, evidence: explained.fact, source: explained.source ?? null, match: "TRANSFERABLE", confidence: 0.6, reason: explained.fact };
  const direct = facts.find((fact) => sharesToken(text, fact.fact));
  if (direct) return { requirement: text, evidence: direct.fact, source: direct.source ?? null, match: "DIRECT", confidence: 0.8, reason: "Verified evidence uses the same wording as the requirement." };
  return { requirement: text, evidence: null, source: null, match: "MISSING", confidence: 0.7, reason: "No verified evidence supports this requirement." };
}

function technologyName(text: string) {
  const match = text.match(/\b([A-Za-z][A-Za-z0-9.+#-]{1,30})\b/g) ?? [];
  const ignore = new Set(["years", "year", "experience", "with", "using", "knowledge", "required", "preferred", "strong", "have", "your"]);
  return match.map((token) => token.toLowerCase()).find((token) => !ignore.has(token) && /[.+#]|js|sql|api/.test(token)) ?? null;
}

function names(fact: EvidenceFact) {
  return [fact.fact, ...(fact.technologies ?? []), ...(fact.skills ?? [])];
}

function sameTechnology(left: string, right: string) {
  return normalizeTech(left) === normalizeTech(right);
}

function normalizeTech(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#]+/g, "");
}

function sharesToken(left: string, right: string) {
  const tokens = left.toLowerCase().split(/[^a-z0-9+#.]+/).filter((token) => token.length > 4);
  const haystack = right.toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}
