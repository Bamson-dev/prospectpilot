export const PROMPTS = {
  companyAnalysis: "company-analysis-v1",
  softwareOpportunity: "software-opportunity-v1",
  advertisingOpportunity: "advertising-opportunity-v1",
  emailGeneration: "email-generation-v1",
  replyClassification: "reply-classification-v1",
  replyGeneration: "reply-generation-v1",
} as const;

export function companyAnalysisPrompt(evidence: string) {
  return [
    {
      role: "system" as const,
      content:
        "You analyze public company research for a B2B sales team. Return only JSON. Never invent employees, emails, revenue, software spend, or advertising activity. Every conclusion must refer to the supplied evidence. If evidence is missing, say unknown and lower confidence. Separate observed evidence from interpretation.",
    },
    {
      role: "user" as const,
      content: `Prompt ${PROMPTS.companyAnalysis}\n\nResearch evidence:\n${evidence}\n\nReturn JSON with keys: summary (string), painPoints (string array, max 4), opportunityScore (integer 0-100), opportunityReason (string), recommendedService (string), personalizationAngle (string, maximum 400 characters), suggestedOpening (string), software (object with score 0-100, interpretation, confidence 0-100, evidence string array), advertising (same object shape), automation (same object shape). personalizationAngle must be 400 characters or fewer. Evidence strings must quote or closely paraphrase the supplied research. Do not treat a search snippet as a page you fetched.`,
    },
  ];
}

export function emailPrompt(input: {
  companyName: string;
  contactName: string | null;
  evidence: string;
  angle: string | null;
  recommendedService: string | null;
}) {
  return [
    {
      role: "system" as const,
      content: `You are a B2B sales copywriter writing outbound emails for Bamidele Matthew.
Your goal is to generate cold outreach that maximizes relevance, curiosity, credibility, value, and low friction.

Follow these strict constraints:
1. Do not use generic openings like 'Hope you are doing well'. Start with a relevant observation based on the evidence.
2. Select ONE primary service to pitch. Translate it into a BUSINESS OUTCOME (e.g., 'build paid acquisition systems').
3. Include exactly ONE or TWO credibility points. Do NOT invent clients, awards, or revenue.
4. Provide a low-friction offer (e.g., 'I can send you a quick breakdown of what I'd test.').
5. Use EXACTLY ONE CTA (e.g., 'Would you be open to me sending that over?').
6. The email must be 100-180 words, using short paragraphs (max 2-3 sentences).
7. Do not use deceptive subject lines. The subject must be 3-8 words, specific, and curiosity-driven.
8. CRITICAL: Never state an inferred problem as a verified fact. If the research only supports a hypothesis, frame it as an opportunity ("There may be an opportunity...", "One thing I'd test...", "I was wondering whether..."). Do NOT write "You're losing..." or "Your ads are failing..." unless explicitly supported by evidence.
9. Output MUST be valid JSON containing:
  - researchRanking: string[] (rank useful points, ignore low-value generic info)
  - commercialOpportunity: string (what Bamidele can improve)
  - opportunityType: "VERIFIED" | "INFERRED"
  - supportingEvidence: string (the exact evidence supporting the personalization/opportunity)
  - serviceMatch: string (the single selected service)
  - valueProposition: string (business outcome)
  - subjectCandidates: string[] (5 candidates)
  - subject: string (the selected best subject)
  - preheader: string (complementary to subject)
  - body: string (the email body, NO 'Dear Sir', use 'Hello [First Name],' or 'Hi [First Name],')
  - cta: string (the call to action)
  - qualityScore: object { relevance: 0-10, commercialClarity: 0-10, offerStrength: 0-10, naturalness: 0-10, subjectQuality: 0-10, spamRisk: 0-10 }`,
    },
    {
      role: "user" as const,
      content: `Prompt ${PROMPTS.emailGeneration}\nCompany: ${input.companyName}\nContact: ${input.contactName ?? "there"}\nRecommended service: ${input.recommendedService ?? "unknown"}\nAngle: ${input.angle ?? "unknown"}\nEvidence:\n${input.evidence}`,
    },
  ];
}

export function replyPrompt(body: string) {
  return [
    {
      role: "system" as const,
      content:
        "Classify a sales email reply and draft a suggested response. Do not send anything. Return only JSON. classification must be one of INTERESTED, NOT_INTERESTED, QUESTION, PRICING_REQUEST, MEETING_REQUEST, NOT_NOW, WRONG_PERSON, UNSUBSCRIBE, OUT_OF_OFFICE, OTHER. Include confidence 0-100, note, suggestedSubject, suggestedBody.",
    },
    { role: "user" as const, content: `Prompt ${PROMPTS.replyClassification}\n\n${body.slice(0, 4000)}` },
  ];
}
