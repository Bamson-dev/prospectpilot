import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeJson, aiRequestCreate } = vi.hoisted(() => ({
  completeJson: vi.fn(),
  aiRequestCreate: vi.fn(async () => ({})),
}));

vi.mock("@/lib/ai/client", () => ({
  completeJson: (messages: unknown) => completeJson(messages),
  hashInput: () => "hash",
}));
vi.mock("@/lib/db", () => ({ prisma: { aIRequest: { create: aiRequestCreate } } }));

import { analyze, EvidenceProvenanceError, qualificationRetryFeedback } from "@/worker/processors/qualification";
import { companyAnalysisSchema } from "@/lib/ai/schemas";

const evidence = "Marketplace agency offering ecommerce strategy, omnichannel performance consulting, and marketplace management for retail brands.";

const base = {
  summary: "Ecommerce strategy agency.",
  painPoints: [],
  opportunityScore: 45,
  opportunityReason: "Public pages describe omnichannel consulting.",
  recommendedService: "Lead management and routing",
  personalizationAngle: "The site describes omnichannel performance consulting.",
  suggestedOpening: "Your site describes omnichannel performance consulting.",
  software: { score: 0, interpretation: "No signal.", confidence: 20, evidence: [] as string[] },
  advertising: { score: 0, interpretation: "No signal.", confidence: 20, evidence: [] as string[] },
  automation: { score: 0, interpretation: "No signal.", confidence: 20, evidence: [] as string[] },
  companyProfile: { businessModel: "Agency", customerTypes: [], locations: [], growthSignals: [] as string[], digitalSignals: [] as string[] },
  opportunities: [{
    type: "AUTOMATION",
    title: "Review enquiry routing",
    evidence: ["ecommerce strategy, omnichannel performance consulting"],
    reasoning: "Routing may need review.",
    likelyPain: "Enquiries need assignment.",
    businessImpact: "Faster follow-up.",
    serviceMatch: "Lead management and routing",
    confidence: 45, urgency: 30, estimatedValue: "Unknown", recommendedAngle: "Map the enquiry path.",
    commercialOpportunityScore: 40, serviceFitScore: 45, urgencyScore: 30, evidenceScore: 40,
    replyProbability: 30, revenuePotential: 20, easeOfDemonstratingValue: 60,
  }],
};

const reply = (value: unknown) => ({ content: JSON.stringify(value), model: "deepseek-chat", durationMs: 1 });
const promptText = (call: number) => (completeJson.mock.calls[call]?.[0] as Array<{ content: string }>).map((m) => m.content).join("\n");

describe("qualification retry feedback", () => {
  beforeEach(() => {
    completeJson.mockReset();
    aiRequestCreate.mockClear();
    process.env.DEEPSEEK_API_KEY = "test-key";
  });

  it("names rejected evidence claims and recovers when the retry removes them", async () => {
    const unsupported = "The company spends R50,000 monthly on paid advertising campaigns.";
    const bad = { ...base, opportunities: [{ ...base.opportunities[0], evidence: [unsupported] }] };
    completeJson.mockResolvedValueOnce(reply(bad)).mockResolvedValueOnce(reply(base));
    const result = await analyze("org", "pros", evidence, "hash");
    expect(result.opportunities[0]?.evidence[0]).toBe("ecommerce strategy, omnichannel performance consulting");
    expect(completeJson).toHaveBeenCalledTimes(2);
    expect(promptText(1)).toContain("Structured retry");
    expect(promptText(1)).toContain(unsupported);
    expect(promptText(1)).toContain("rejected 1 evidence items");
  });

  it("reports the over-limit field and its length, and recovers on a corrected retry", async () => {
    const bad = { ...base, suggestedOpening: "x".repeat(340) };
    completeJson.mockResolvedValueOnce(reply(bad)).mockResolvedValueOnce(reply(base));
    await analyze("org", "pros", evidence, "hash");
    expect(promptText(1)).toContain("suggestedOpening has 340 characters, limit 300");
    expect(companyAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it("still rejects output that stays invalid after the single retry, without truncating it", async () => {
    const tooLong = { ...base, suggestedOpening: "x".repeat(340) };
    completeJson.mockResolvedValue(reply(tooLong));
    await expect(analyze("org", "pros", evidence, "hash")).rejects.toThrow("DeepSeek returned malformed qualification JSON.");
    expect(completeJson).toHaveBeenCalledTimes(2);
    const statuses = aiRequestCreate.mock.calls.map((call) => (call as unknown as [{ data: { status: string } }])[0].data.status);
    expect(statuses).toEqual(["failed", "failed"]);
  });

  it("still rejects unsupported evidence on both attempts", async () => {
    const bad = { ...base, opportunities: [{ ...base.opportunities[0], evidence: ["Spends R50,000 monthly on paid advertising campaigns."] }] };
    completeJson.mockResolvedValue(reply(bad));
    await expect(analyze("org", "pros", evidence, "hash")).rejects.toThrow("DeepSeek returned malformed qualification JSON.");
    expect(completeJson).toHaveBeenCalledTimes(2);
  });

  it("caps the listed claims and keeps the count in the message", () => {
    const claims = Array.from({ length: 10 }, (_, index) => `unsupported claim number ${index} ${"y".repeat(300)}`);
    const feedback = qualificationRetryFeedback(new EvidenceProvenanceError(claims));
    expect(feedback).toContain("rejected 10 evidence items");
    expect(feedback).toContain("claim number 5");
    expect(feedback).not.toContain("claim number 6");
    expect(feedback.length).toBeLessThan(1500);
  });
});
