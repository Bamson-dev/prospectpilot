import { sameTechnology, technologiesMentioned } from "@/lib/applications/technologies";

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

const STOP = new Set([
  "experience", "building", "products", "product", "strong", "working", "skills", "skill", "ability",
  "knowledge", "using", "required", "preferred", "modern", "software", "development", "applications",
  "application", "systems", "system", "solutions", "solution", "team", "teams", "professional", "including",
  "across", "with", "from", "that", "this", "your", "have", "will", "role", "years", "year", "data",
  "tools", "tool", "metrics", "approach", "hiring", "judgment", "informed", "model", "models", "code",
  "production", "services", "service", "platform", "engineering", "work", "deep", "practical",
]);

export function selectEvidence(requirement: string, facts: EvidenceFact[]): EvidenceSelection {
  const text = requirement.trim();
  const years = text.match(/(\d{1,2})\+?\s*(?:years|yrs)/i);
  if (years) return yearsSelection(text, Number(years[1]), facts);
  if (/\b(bachelor|master(?:'|’)?s|masters|phd|mba|degree|university)\b/i.test(text)) return credentialSelection(text, facts);
  if (/sponsor|work authorization|authorized to work|eligible to work|\bvisa\b|must be (located|based|resident)|must reside/i.test(text)) {
    return { requirement: text, evidence: null, source: null, match: "UNCERTAIN", confidence: 0.4, reason: "Candidate evidence missing." };
  }
  const named = technologiesMentioned(text);
  if (named.length) return technologySelection(text, named, facts);
  const explained = facts.find((fact) => /transferable to/i.test(fact.fact) && fact.fact.toLowerCase().includes(text.toLowerCase()));
  if (explained) return { requirement: text, evidence: explained.fact, source: explained.source ?? null, match: "TRANSFERABLE", confidence: 0.6, reason: explained.fact };
  const token = distinctiveTokens(text).find((value) => facts.some((fact) => sharesDistinctiveToken(value, names(fact).join(" "))));
  const direct = token ? facts.find((fact) => sharesDistinctiveToken(token, names(fact).join(" "))) : undefined;
  if (direct && token) return { requirement: text, evidence: direct.fact, source: direct.source ?? null, match: "DIRECT", confidence: 0.8, reason: `Verified evidence names ${token}.` };
  return { requirement: text, evidence: null, source: null, match: "MISSING", confidence: 0.7, reason: "Candidate evidence missing." };
}

function yearsSelection(text: string, wanted: number, facts: EvidenceFact[]): EvidenceSelection {
  const named = technologiesMentioned(text);
  const namedFact = named.map((name) => ({ name, fact: factForTechnology(name, facts) })).find((item) => item.fact);
  const duration = verifiedDuration(facts, named);
  if (duration == null) {
    return {
      requirement: text,
      evidence: namedFact?.fact?.fact ?? null,
      source: namedFact?.fact?.source ?? null,
      match: "UNCERTAIN",
      confidence: 0.4,
      reason: namedFact
        ? `Verified evidence names ${namedFact.name}. No verified duration is on file, so this years requirement stays uncertain.`
        : "The requirement asks for a duration, and no verified duration is on file.",
    };
  }
  const support = durationFact(facts, named, duration);
  if (duration >= wanted) {
    return { requirement: text, evidence: support?.fact ?? null, source: support?.source ?? null, match: "DIRECT", confidence: 0.9, reason: `Verified evidence states ${duration} years.` };
  }
  return { requirement: text, evidence: support?.fact ?? null, source: support?.source ?? null, match: "MISSING", confidence: 0.9, reason: `Verified duration is ${duration} years, which is below ${wanted}.` };
}

function credentialSelection(text: string, facts: EvidenceFact[]): EvidenceSelection {
  const fact = facts.find((item) => item.category === "EDUCATION" || item.category === "CERTIFICATION");
  if (fact) return { requirement: text, evidence: fact.fact, source: fact.source ?? null, match: "DIRECT", confidence: 0.9, reason: "Verified evidence names this credential." };
  return { requirement: text, evidence: null, source: null, match: "MISSING", confidence: 0.8, reason: "Candidate evidence missing." };
}

function technologySelection(text: string, named: string[], facts: EvidenceFact[]): EvidenceSelection {
  const hits = named.flatMap((name) => {
    const fact = factForTechnology(name, facts);
    return fact ? [{ name, fact }] : [];
  });
  const alternative = /\bor\b|and\/or|at least one|one of|\//i.test(text);
  if (alternative || named.length === 1) {
    const hit = hits[0];
    if (hit) return { requirement: text, evidence: hit.fact.fact, source: hit.fact.source ?? null, match: "DIRECT", confidence: 0.95, reason: `Verified evidence names ${hit.name}.` };
    return { requirement: text, evidence: null, source: null, match: "MISSING", confidence: 0.9, reason: "No verified evidence names this technology. A different technology is not treated as the same skill." };
  }
  if (hits.length === named.length) {
    return { requirement: text, evidence: hits.map((hit) => hit.fact.fact).join(" "), source: hits[0]?.fact.source ?? null, match: "DIRECT", confidence: 0.95, reason: `Verified evidence names ${named.join(", ")}.` };
  }
  const missing = named.filter((name) => !hits.some((hit) => hit.name === name));
  return { requirement: text, evidence: null, source: null, match: "MISSING", confidence: 0.9, reason: `No verified evidence names ${missing.join(", ")}. A different technology is not treated as the same skill.` };
}

function factForTechnology(name: string, facts: EvidenceFact[]) {
  return facts.find((fact) => names(fact).some((value) => sameTechnology(value, name))) ?? null;
}

function verifiedDuration(facts: EvidenceFact[], named: string[]) {
  for (const fact of facts) {
    const match = fact.fact.match(/(\d{1,2})\+?\s*(?:years|yrs)/i);
    if (!match) continue;
    if (named.length === 0 || named.some((name) => names(fact).some((value) => sameTechnology(value, name)))) return Number(match[1]);
  }
  return null;
}

function durationFact(facts: EvidenceFact[], named: string[], duration: number) {
  return facts.find((fact) => new RegExp(`${duration}\\+?\\s*(?:years|yrs)`, "i").test(fact.fact) && (named.length === 0 || named.some((name) => names(fact).some((value) => sameTechnology(value, name))))) ?? null;
}

function names(fact: EvidenceFact) {
  return [fact.fact, ...(fact.technologies ?? []), ...(fact.skills ?? [])];
}

function sharesDistinctiveToken(left: string, right: string) {
  const tokens = distinctiveTokens(left);
  if (!tokens.length) return false;
  return tokens.some((token) => new RegExp(`\\b${token.replace(/[.+]/g, "\\$&")}\\b`, "i").test(right));
}

function distinctiveTokens(text: string) {
  return text.toLowerCase().split(/[^a-z0-9+#.]+/).filter((token) => (token.length > 4 || token === "saas") && !STOP.has(token));
}
