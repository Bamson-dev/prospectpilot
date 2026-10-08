import { describe, expect, it } from "vitest";
import { companyAnalysisPrompt } from "@/lib/ai/prompts";
import { companyAnalysisSchema } from "@/lib/ai/schemas";
import { ACTIVE_QUALIFICATION_JOB_STATES } from "@/lib/research/evidence";
import { qualificationRetryFeedback } from "@/worker/processors/qualification";

const validAnalysis = {
  summary: "Public research describes the company’s services.",
  painPoints: [],
  opportunityScore: 45,
  opportunityReason: "The observed digital journey supports a limited test.",
  recommendedService: "Lead management and routing",
  personalizationAngle: "The site presents several service lines.",
  suggestedOpening: "Your site presents several service lines.",
  software: { score: 0, interpretation: "No software signal observed.", confidence: 20, evidence: [] },
  advertising: { score: 0, interpretation: "No advertising signal observed.", confidence: 20, evidence: [] },
  automation: { score: 0, interpretation: "No automation signal observed.", confidence: 20, evidence: [] },
  companyProfile: { businessModel: "Services", customerTypes: [], locations: [], growthSignals: [], digitalSignals: [] },
  opportunities: [{
    type: "AUTOMATION",
    title: "Review enquiry routing",
    evidence: ["The site presents several service lines."],
    reasoning: "This could make routing worth reviewing.",
    likelyPain: "Enquiries may need assignment.",
    businessImpact: "Clearer ownership may improve follow-up.",
    serviceMatch: "Lead management and routing",
    confidence: 45,
    urgency: 30,
    estimatedValue: "Qualitative: unknown",
    recommendedAngle: "Map the public enquiry path.",
    commercialOpportunityScore: 40,
    serviceFitScore: 45,
    urgencyScore: 30,
    evidenceScore: 40,
    replyProbability: 30,
    revenuePotential: 20,
    easeOfDemonstratingValue: 60,
  }],
};

describe("company qualification output contract", () => {
  it("distinguishes opportunity category enums from catalogue service names", () => {
    const initialPrompt = companyAnalysisPrompt("Verified public page evidence.").map((message) => message.content).join("\n");
    expect(initialPrompt).toContain("type MUST be exactly one of CUSTOM_SOFTWARE");
    expect(initialPrompt).toContain("serviceMatch is a separate field");
    expect(initialPrompt).not.toContain("Structured retry");
    const retryPrompt = companyAnalysisPrompt("Verified public page evidence.", true, "Schema validation failed at: companyProfile.growthSignals").map((message) => message.content).join("\n");
    expect(retryPrompt).toContain("Structured retry");
    expect(retryPrompt).toContain("Never put a service name in type");
    expect(retryPrompt).toContain("300 characters maximum");
    expect(retryPrompt).toContain("evidence-provenance validation");
    expect(retryPrompt).toContain("Schema validation failed at: companyProfile.growthSignals");
  });

  it("accepts category plus exact service and rejects a service label as the category", () => {
    expect(companyAnalysisSchema.safeParse(validAnalysis).success).toBe(true);
    const invalid = {
      ...validAnalysis,
      opportunities: [{ ...validAnalysis.opportunities[0], type: "Lead management and routing" }],
    };
    expect(companyAnalysisSchema.safeParse(invalid).success).toBe(false);
  });

  it("enforces the 400-character personalization limit", () => {
    expect(companyAnalysisSchema.safeParse({ ...validAnalysis, personalizationAngle: "a".repeat(400) }).success).toBe(true);
    expect(companyAnalysisSchema.safeParse({ ...validAnalysis, personalizationAngle: "a".repeat(401) }).success).toBe(false);
  });

  it("enforces 300-character limits on company growth and digital signals", () => {
    expect(companyAnalysisSchema.safeParse({
      ...validAnalysis,
      companyProfile: { ...validAnalysis.companyProfile, growthSignals: ["a".repeat(300)] },
    }).success).toBe(true);
    expect(companyAnalysisSchema.safeParse({
      ...validAnalysis,
      companyProfile: { ...validAnalysis.companyProfile, digitalSignals: ["a".repeat(301)] },
    }).success).toBe(false);
  });

  it("converts schema and provenance failures into specific safe retry guidance", () => {
    const invalid = companyAnalysisSchema.safeParse({
      ...validAnalysis,
      companyProfile: { ...validAnalysis.companyProfile, growthSignals: ["a".repeat(301)] },
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      const feedback = qualificationRetryFeedback(invalid.error);
      expect(feedback).toContain("companyProfile.growthSignals");
      expect(feedback).toContain("300 characters");
    }
    const provenanceFeedback = qualificationRetryFeedback(new Error("AI evidence provenance failed for 6 claim(s)."));
    expect(provenanceFeedback).toContain("rejected 6 evidence items");
    expect(provenanceFeedback).toContain("omit unsupported evidence");
  });

  it("does not let terminal failed jobs block a safe qualification retry", () => {
    expect(ACTIVE_QUALIFICATION_JOB_STATES).toEqual(["QUEUED", "ACTIVE", "DELAYED"]);
    expect(ACTIVE_QUALIFICATION_JOB_STATES).not.toContain("FAILED");
    expect(ACTIVE_QUALIFICATION_JOB_STATES).not.toContain("COMPLETED");
    expect(ACTIVE_QUALIFICATION_JOB_STATES).not.toContain("CANCELLED");
  });
});
