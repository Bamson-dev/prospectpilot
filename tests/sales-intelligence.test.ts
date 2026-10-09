import { describe, expect, it } from "vitest";
import { assessSalesDraft, rankOpportunities, assertSafeOutboundCopy, unsupportedEvidenceClaims, evidenceProvenanceFindings, type SalesOpportunity } from "@/lib/sales/intelligence";
import { buildFollowUpCopy } from "@/lib/sales/follow-up-copy";

const strong = {
  subject: "A thought on your enquiry flow",
  body: `Hi there,\n\nYour Johannesburg team handles a broad property portfolio, and the site routes viewing enquiries through individual listing forms. At that scale, consistent routing and follow-up can have a real effect on how quickly interested buyers reach the right agent.\n\nI build lead-management workflows for property teams. I can map the enquiry path and send you three practical changes to test, based on the public journey I reviewed.\n\nWould you like me to send the short map?\n\nBest,\nBamidele`,
  cta: "Would you like me to send the short map?",
  commercialOpportunity: "Improve inquiry response across the regional portfolio.",
  supportingEvidence: "Research: Johannesburg property portfolio and listing-level viewing enquiry forms.",
  serviceMatch: "Lead management and routing",
  valueProposition: "A short map with three practical changes to test.",
  qualityScore: { relevance: 8, commercialClarity: 8, offerStrength: 8, naturalness: 8, subjectQuality: 8, replyLikelihood: 8, spamRisk: 1 },
  versions: [
    { approach: "OPPORTUNITY" as const, subjectCandidates: ["A thought on your enquiry flow"], body: "Opportunity version.", scores: { relevance: 8, curiosity: 8, commercialClarity: 8, credibility: 8, naturalness: 8, replyLikelihood: 8, spamRisk: 1 } },
    { approach: "PROBLEM" as const, subjectCandidates: ["Property enquiry follow-up"], body: "Problem version.", scores: { relevance: 8, curiosity: 8, commercialClarity: 8, credibility: 8, naturalness: 8, replyLikelihood: 8, spamRisk: 1 } },
    { approach: "CURIOSITY" as const, subjectCandidates: ["A property journey idea"], body: "Curiosity version.", scores: { relevance: 8, curiosity: 8, commercialClarity: 8, credibility: 8, naturalness: 8, replyLikelihood: 8, spamRisk: 1 } },
  ],
};

const opportunity = (title: string, score: number, overrides: Partial<SalesOpportunity> = {}): SalesOpportunity => ({
  type: "AUTOMATION",
  title,
  evidence: ["Multiple office locations are listed."],
  reasoning: "Evidence suggests a workflow worth reviewing.",
  likelyPain: "Enquiries may require coordination.",
  businessImpact: "Faster response and clearer ownership.",
  serviceMatch: "Lead routing automation",
  confidence: 70,
  urgency: 50,
  estimatedValue: "Qualitative: moderate",
  recommendedAngle: "Map how new enquiries reach each office.",
  commercialOpportunityScore: score,
  serviceFitScore: score,
  urgencyScore: score,
  evidenceScore: score,
  replyProbability: score,
  revenuePotential: score,
  easeOfDemonstratingValue: score,
  ...overrides,
});

describe("sales intelligence and outbound quality", () => {
  it("ranks evidence-backed opportunities by commercial fit rather than listing volume", () => {
    const ranked = rankOpportunities([
      opportunity("Raw company size", 40),
      opportunity("Enquiry routing", 85, { evidenceScore: 95, serviceFitScore: 90 }),
    ]);
    expect(ranked[0]?.title).toBe("Enquiry routing");
    expect(ranked[0]?.rankScore).toBeGreaterThan(ranked[1]?.rankScore ?? 0);
  });

  it("rejects unsupported opportunity evidence and retains traceable observations", () => {
    const research = "The company lists 316 properties across Johannesburg South and displays viewing enquiry forms.";
    expect(unsupportedEvidenceClaims({
      opportunities: [{ evidence: ["316 properties are listed across Johannesburg South."] }],
      software: { evidence: ["Viewing enquiry forms appear on listing pages."] },
      advertising: { evidence: [] },
      automation: { evidence: [] },
    }, research)).toEqual([]);
    expect(unsupportedEvidenceClaims({
      opportunities: [{ evidence: ["The company spends R50,000 monthly on paid ads."] }],
      software: { evidence: [] },
      advertising: { evidence: [] },
      automation: { evidence: [] },
    }, research)).toHaveLength(1);
  });

  it("accepts short claims quoted verbatim from the research and still rejects invented ones", () => {
    const research = 'Page text: Our portfolio spans 175+ brands across retail. Signals: {"technologies":["wix"]}';
    const empty = { software: { evidence: [] }, advertising: { evidence: [] }, automation: { evidence: [] } };
    expect(unsupportedEvidenceClaims({ opportunities: [{ evidence: ["Page text: '175+ brands'", "Technology: wix"] }], ...empty }, research)).toEqual([]);
    expect(unsupportedEvidenceClaims({ opportunities: [{ evidence: ["Page text: '500+ brands'", "Technology: shopify", "wix"] }], ...empty }, research)).toEqual(["Page text: '500+ brands'", "Technology: shopify"]);
    expect(unsupportedEvidenceClaims({ opportunities: [{ evidence: ["Technology: wi"] }], ...empty }, research)).toHaveLength(1);
  });

  it("reports the field path, claim text and overlap for each rejected claim", () => {
    const research = "The company lists 316 properties across Johannesburg South and displays viewing enquiry forms.";
    const findings = evidenceProvenanceFindings({
      opportunities: [{ evidence: ["316 properties are listed across Johannesburg South."] }, { evidence: ["No automated lead follow-up is visible."] }],
      software: { evidence: [] },
      advertising: { evidence: ["The company spends R50,000 monthly on paid ads."] },
      automation: { evidence: [] },
    }, research);
    expect(findings.map((item) => item.path)).toEqual(["opportunities.1.evidence.0", "advertising.evidence.0"]);
    expect(findings[0]?.claim).toBe("No automated lead follow-up is visible.");
    expect(findings.every((item) => item.overlap < 2)).toBe(true);
  });

  it("accepts a specific opportunity, service, offer and single CTA", () => {
    expect(assessSalesDraft(strong).accepted).toBe(true);
  });

  it.each([
    "I do not have enough evidence to recommend a specific service.",
    "We could not identify a specific service to recommend.",
    "Without knowing your current tech stack, it is hard to say.",
    "[Your Name]",
    "Would you be open to a brief conversation?",
  ])("rejects forbidden language and unresolved placeholders: %s", (phrase) => {
    const candidate = { ...strong, body: `${strong.body}\n${phrase}` };
    expect(assessSalesDraft(candidate).accepted).toBe(false);
    expect(() => assertSafeOutboundCopy(candidate.subject, candidate.body)).toThrow();
  });

  it("rejects a missing offer, multiple questions, or low reply-likelihood score", () => {
    expect(assessSalesDraft({ ...strong, cta: "Send it?", body: strong.body.replace(strong.cta, "Would you like the map?") }).reasons).toContain("cta_missing_from_body");
    expect(assessSalesDraft({ ...strong, body: `${strong.body} Any questions?` }).reasons).toContain("requires_one_clear_question");
    expect(assessSalesDraft({ ...strong, qualityScore: { ...strong.qualityScore, replyLikelihood: 7 } }).reasons).toContain("model_quality_below_threshold");
  });

  it("uses a new evidence-backed angle for follow-ups and refuses missing evidence", () => {
    const angle = { title: "Landing page conversion", service: "Website conversion optimization", angle: "review the listing-to-enquiry steps", evidence: ["The site sends users from listings to a viewing enquiry form."] };
    const copy = buildFollowUpCopy("Example Realty", "Morgan Lee", angle);
    expect(copy?.subject).toContain("Example Realty");
    expect(copy?.body).toContain("listing-to-enquiry steps");
    expect(copy?.body).not.toMatch(/just following up/i);
    expect(copy?.body.match(/\?/g)).toHaveLength(1);
    expect(buildFollowUpCopy("Example Realty", null, { ...angle, evidence: [] })).toBe(null);
  });
});
