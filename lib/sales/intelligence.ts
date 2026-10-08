import type { EmailDraft } from "@/lib/ai/schemas";

export type SalesOpportunity = {
  type: string;
  title: string;
  evidence: string[];
  reasoning: string;
  likelyPain: string;
  businessImpact: string;
  serviceMatch: string;
  confidence: number;
  urgency: number;
  estimatedValue: string;
  recommendedAngle: string;
  commercialOpportunityScore: number;
  serviceFitScore: number;
  urgencyScore: number;
  evidenceScore: number;
  replyProbability: number;
  revenuePotential: number;
  easeOfDemonstratingValue: number;
};

const WEIGHTS = {
  commercialOpportunityScore: 0.2,
  serviceFitScore: 0.18,
  urgencyScore: 0.1,
  evidenceScore: 0.18,
  replyProbability: 0.12,
  revenuePotential: 0.1,
  easeOfDemonstratingValue: 0.12,
} as const;

export function rankOpportunities<T extends SalesOpportunity>(opportunities: T[]) {
  return opportunities
    .map((opportunity) => ({
      ...opportunity,
      rankScore: Math.round(Object.entries(WEIGHTS).reduce(
        (score, [key, weight]) => score + opportunity[key as keyof typeof WEIGHTS] * weight,
        0,
      )),
    }))
    .sort((a, b) => b.rankScore - a.rankScore);
}

const FORBIDDEN_OUTREACH = [
  /i\s+(?:do\s+not|don't)\s+have\s+enough\s+(?:evidence|information)/i,
  /i\s+don't\s+know\s+if\s+(?:you|your\s+company)/i,
  /we\s+could\s+not\s+identify\s+a\s+specific\s+service/i,
  /could\s+not\s+recommend\s+a\s+specific\s+service/i,
  /without\s+knowing\s+your\s+(?:current\s+)?tech(?:nology)?\s+stack/i,
  /based\s+on\s+the\s+available\s+evidence/i,
  /i\s+would\s+like\s+to\s+understand\s+whether/i,
  /would\s+you\s+be\s+open\s+to\s+a\s+brief\s+conversation/i,
  /\bwe\s+help\s+(?:businesses|companies)\s+like\s+yours\b/i,
  /\bjust\s+following\s+up\b/i,
  /\bi\s+came\s+across\s+(?:your\s+)?(?:company|website)\b/i,
  /\bthere\s+may\s+be\s+an\s+opportunity\b/i,
  /\bperhaps\s+you\s+need\b/i,
];

const PLACEHOLDER = /\[(?:your\s+name|company|contact|first\s+name|last\s+name|insert[^\]]*)\]|\{\{[^}]+\}\}|<\s*(?:name|company|email)[^>]*>/i;

export type DraftQuality = {
  accepted: boolean;
  reasons: string[];
  wordCount: number;
};

export function assessSalesDraft(
  draft: Pick<EmailDraft, "subject" | "body" | "cta" | "supportingEvidence" | "qualityScore" | "commercialOpportunity" | "serviceMatch" | "valueProposition" | "versions">,
  researchEvidence?: string,
): DraftQuality {
  const reasons: string[] = [];
  const searchable = `${draft.subject}\n${draft.body}`;
  if (FORBIDDEN_OUTREACH.some((pattern) => pattern.test(searchable))) reasons.push("forbidden_language");
  if (PLACEHOLDER.test(searchable) || /\b(?:\[your name\]|your name here)\b/i.test(searchable)) reasons.push("placeholder");
  const wordCount = draft.body.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 70 || wordCount > 190) reasons.push("length_out_of_range");
  const subjectWords = draft.subject.trim().split(/\s+/).filter(Boolean).length;
  if (subjectWords < 3 || subjectWords > 8) reasons.push("subject_length_out_of_range");
  if (!draft.versions.some((version) => version.subjectCandidates.some((candidate) => candidate.trim() === draft.subject.trim()))) reasons.push("subject_not_in_candidates");
  if (!draft.supportingEvidence.trim() || draft.supportingEvidence.length < 15) reasons.push("missing_evidence");
  if (!draft.commercialOpportunity.trim() || !draft.serviceMatch.trim() || !draft.valueProposition.trim()) reasons.push("missing_commercial_offer");
  if (researchEvidence && meaningfulOverlap(draft.supportingEvidence, researchEvidence) < 2) reasons.push("supporting_evidence_not_traceable");
  if (researchEvidence && meaningfulOverlap(draft.body, researchEvidence) < 2) reasons.push("personalization_not_evidence_based");
  if (!draft.cta.trim() || !draft.body.includes(draft.cta.trim())) reasons.push("cta_missing_from_body");
  const questionMarks = (draft.body.match(/\?/g) ?? []).length;
  if (questionMarks !== 1) reasons.push("requires_one_clear_question");
  const { relevance, commercialClarity, offerStrength, naturalness, subjectQuality, replyLikelihood, spamRisk } = draft.qualityScore;
  if (relevance < 8 || commercialClarity < 8 || offerStrength < 8 || naturalness < 8 || subjectQuality < 8 || replyLikelihood < 8 || spamRisk > 2) {
    reasons.push("model_quality_below_threshold");
  }
  return { accepted: reasons.length === 0, reasons, wordCount };
}

function meaningfulOverlap(left: string, right: string) {
  const ignored = new Set(["about", "after", "again", "agency", "business", "company", "their", "there", "these", "those", "through", "using", "would", "which", "where", "while", "with", "your", "from", "into", "have", "that", "this", "they", "them", "were", "when", "what", "will", "some", "such", "more", "most", "also", "only", "than", "then", "been", "being", "were", "could", "should", "might", "about", "website", "page", "site", "research", "source", "public"]);
  const tokens = (value: string) => new Set((value.toLowerCase().match(/[a-z0-9][a-z0-9-]{4,}/g) ?? []).filter((token) => !ignored.has(token)));
  const leftTokens = tokens(left);
  return [...tokens(right)].filter((token) => leftTokens.has(token)).length;
}

export function unsupportedEvidenceClaims(analysis: {
  opportunities: Array<{ evidence: string[] }>;
  software: { evidence: string[] };
  advertising: { evidence: string[] };
  automation: { evidence: string[] };
}, source: string) {
  const claims = [
    ...analysis.opportunities.flatMap((item) => item.evidence),
    ...analysis.software.evidence,
    ...analysis.advertising.evidence,
    ...analysis.automation.evidence,
  ];
  return claims.filter((claim) => meaningfulOverlap(claim, source) < 2);
}

export function assertSafeOutboundCopy(subject: string, body: string) {
  const text = `${subject}\n${body}`;
  if (FORBIDDEN_OUTREACH.some((pattern) => pattern.test(text))) throw new Error("Message contains language that must not be sent to a prospect.");
  if (PLACEHOLDER.test(text)) throw new Error("Message contains an unresolved personalization placeholder.");
}
