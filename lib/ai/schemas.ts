import { z } from "zod";

const assessment = z.object({
  score: z.number().min(0).max(100),
  interpretation: z.string().min(1).max(800),
  confidence: z.number().min(0).max(100),
  evidence: z.array(z.string().min(1).max(400)).max(6),
});

export const companyAnalysisSchema = z.object({
  summary: z.string().min(1).max(1200),
  painPoints: z.array(z.string().min(1).max(240)).max(4),
  opportunityScore: z.number().min(0).max(100),
  opportunityReason: z.string().min(1).max(800),
  recommendedService: z.string().min(1).max(240),
  personalizationAngle: z.string().min(1).max(400),
  suggestedOpening: z.string().min(1).max(300),
  software: assessment,
  advertising: assessment,
  automation: assessment,
});

export const emailDraftSchema = z.object({
  researchRanking: z.array(z.string()).max(10),
  commercialOpportunity: z.string().max(800),
  opportunityType: z.enum(["VERIFIED", "INFERRED"]),
  supportingEvidence: z.string().max(800),
  serviceMatch: z.string().max(200),
  valueProposition: z.string().max(400),
  subjectCandidates: z.array(z.string()).max(10),
  subject: z.string().min(1).max(160),
  preheader: z.string().max(200).optional().default(""),
  body: z.string().min(1).max(4000),
  cta: z.string().max(200),
  qualityScore: z.object({
    relevance: z.number().min(0).max(10),
    commercialClarity: z.number().min(0).max(10),
    offerStrength: z.number().min(0).max(10),
    naturalness: z.number().min(0).max(10),
    subjectQuality: z.number().min(0).max(10),
    spamRisk: z.number().min(0).max(10),
  }),
});

export const replyAnalysisSchema = z.object({
  classification: z.enum([
    "INTERESTED",
    "NOT_INTERESTED",
    "QUESTION",
    "PRICING_REQUEST",
    "MEETING_REQUEST",
    "NOT_NOW",
    "WRONG_PERSON",
    "UNSUBSCRIBE",
    "OUT_OF_OFFICE",
    "OTHER",
  ]),
  confidence: z.number().min(0).max(100),
  note: z.string().max(500).optional().default(""),
  suggestedSubject: z.string().min(1).max(160),
  suggestedBody: z.string().min(1).max(4000),
});

export type CompanyAnalysis = z.infer<typeof companyAnalysisSchema>;
export type EmailDraft = z.infer<typeof emailDraftSchema>;
export type ReplyAnalysis = z.infer<typeof replyAnalysisSchema>;

export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return JSON.");
  return JSON.parse(candidate.slice(start, end + 1));
}
