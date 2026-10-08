import { z } from "zod";
import { SERVICE_CATALOGUE } from "@/lib/sales/service-catalog";

const serviceName = z.string().min(1).max(160).refine(
  (value) => SERVICE_CATALOGUE.some((service) => service.name === value),
  "Choose one exact service from the service catalogue.",
);

const assessment = z.object({
  score: z.number().min(0).max(100),
  interpretation: z.string().min(1).max(800),
  confidence: z.number().min(0).max(100),
  evidence: z.array(z.string().min(1).max(400)).max(6),
});

const opportunity = z.object({
  type: z.enum(["CUSTOM_SOFTWARE", "SOFTWARE_REPLACEMENT", "AUTOMATION", "ADVERTISING_MANAGEMENT", "ADVERTISING_OPTIMIZATION", "OTHER"]),
  title: z.string().min(1).max(160),
  evidence: z.array(z.string().min(1).max(400)).min(1).max(5),
  reasoning: z.string().min(1).max(800),
  likelyPain: z.string().min(1).max(400),
  businessImpact: z.string().min(1).max(400),
  serviceMatch: serviceName,
  confidence: z.number().min(0).max(100),
  urgency: z.number().min(0).max(100),
  estimatedValue: z.string().min(1).max(120),
  recommendedAngle: z.string().min(1).max(400),
  commercialOpportunityScore: z.number().min(0).max(100),
  serviceFitScore: z.number().min(0).max(100),
  urgencyScore: z.number().min(0).max(100),
  evidenceScore: z.number().min(0).max(100),
  replyProbability: z.number().min(0).max(100),
  revenuePotential: z.number().min(0).max(100),
  easeOfDemonstratingValue: z.number().min(0).max(100),
});

export const companyAnalysisSchema = z.object({
  summary: z.string().min(1).max(1200),
  painPoints: z.array(z.string().min(1).max(240)).max(4),
  opportunityScore: z.number().min(0).max(100),
  opportunityReason: z.string().min(1).max(800),
  recommendedService: serviceName,
  personalizationAngle: z.string().min(1).max(400),
  suggestedOpening: z.string().min(1).max(300),
  software: assessment,
  advertising: assessment,
  automation: assessment,
  companyProfile: z.object({
    businessModel: z.string().max(300),
    customerTypes: z.array(z.string().max(120)).max(8),
    locations: z.array(z.string().max(120)).max(12),
    growthSignals: z.array(z.string().max(300)).max(8),
    digitalSignals: z.array(z.string().max(300)).max(12),
  }),
  opportunities: z.array(opportunity).max(5),
});

export const emailDraftSchema = z.object({
  researchRanking: z.array(z.string()).max(10),
  commercialOpportunity: z.string().min(1).max(800),
  opportunityType: z.enum(["VERIFIED", "INFERRED"]),
  supportingEvidence: z.string().min(15).max(800),
  serviceMatch: serviceName,
  valueProposition: z.string().min(1).max(800),
  versions: z.array(
    z.object({
      approach: z.enum(["OPPORTUNITY", "PROBLEM", "CURIOSITY"]),
      subjectCandidates: z.array(z.string().min(1).max(120)).min(1).max(5),
      body: z.string().min(1).max(4000),
      scores: z.object({
        relevance: z.number().min(0).max(10),
        curiosity: z.number().min(0).max(10),
        commercialClarity: z.number().min(0).max(10),
        credibility: z.number().min(0).max(10),
        naturalness: z.number().min(0).max(10),
        replyLikelihood: z.number().min(0).max(10),
        spamRisk: z.number().min(0).max(10),
      }),
    })
  ).length(3),
  subject: z.string().min(1).max(160),
  preheader: z.string().max(200).optional().default(""),
  body: z.string().min(1).max(4000),
  cta: z.string().min(1).max(200),
  qualityScore: z.object({
    relevance: z.number().min(0).max(10),
    commercialClarity: z.number().min(0).max(10),
    offerStrength: z.number().min(0).max(10),
    naturalness: z.number().min(0).max(10),
    subjectQuality: z.number().min(0).max(10),
    replyLikelihood: z.number().min(0).max(10),
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
