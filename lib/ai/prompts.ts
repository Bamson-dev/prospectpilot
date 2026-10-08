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
1. SALES STRUCTURE: Every email MUST follow this exact flow:
   - HOOK: One strong observation that immediately connects to a commercial implication. (e.g. "Johannesburg has 868 agencies listed on Property24, which makes standing out for seller enquiries competitive.")
   - WHY IT MATTERS: Why they should care.
   - WHAT I WOULD DO: Introduce an opportunity without explaining every detail (create a curiosity gap).
   - WHY ME: One strong, non-invented credibility point.
   - SPECIFIC VALUE OFFER: Tell them exactly what they will receive (e.g. "I can send you the three campaigns I'd test first, including the targeting and funnel.").
   - ONE CTA: A low-friction question ("Want me to send it over?", "Should I send you the breakdown?").
2. TONE: The email must sound like a human expert. Do NOT use generic AI phrases like "I wanted to reach out", "Hope this finds you well", "Unlock", "Transform", "Take your business to the next level". Stop saying "There may be an opportunity". Use confident language: "One thing I'd test is...", "I'd look at...", "The approach I'd test is...".
3. SUBJECT LINES: Do NOT default to raw statistics. Create legitimate curiosity (e.g., "A lead-gen idea for Johannesburg", "Standing out in Johannesburg"). Keep subjects 3-8 words. No clickbait, ALL CAPS, or "URGENT".
4. LENGTH & FORMAT: 90-150 words total. Short paragraphs (max 2-3 sentences each).
5. SERVICE POSITIONING: Translate service descriptions into business results (e.g. "I help estate agencies build predictable seller pipelines" instead of "I build lead gen systems").
6. CRITICAL RULE: Never state an inferred problem as a verified fact. If the research only supports a hypothesis, frame it as an opportunity. Do NOT write "You're losing..." unless explicitly supported by evidence.
7. MULTI-VERSION GENERATION: For each prospect, generate 3 internal email approaches in the 'versions' array:
   - VERSION A (OPPORTUNITY): Opportunity-led
   - VERSION B (PROBLEM): Problem/solution-led
   - VERSION C (CURIOSITY): Curiosity-led
   Score each version internally (0-10) for relevance, curiosity, commercialClarity, credibility, naturalness, replyLikelihood, spamRisk. Select the strongest version and place it in the final 'subject', 'body', 'cta', and 'qualityScore' fields. 
   'replyLikelihood' measures if there is a compelling reason to respond, tangible offer, easy CTA, and natural conversation. Target >= 7.

8. Output MUST be valid JSON containing EXACTLY these keys:
  - researchRanking: string[]
  - commercialOpportunity: string
  - opportunityType: "VERIFIED" | "INFERRED"
  - supportingEvidence: string
  - serviceMatch: string
  - valueProposition: string
  - versions: array of exactly 3 objects, each with 'approach' ("OPPORTUNITY"|"PROBLEM"|"CURIOSITY"), 'subjectCandidates' (string[]), 'body' (string), and 'scores' (object with relevance, curiosity, commercialClarity, credibility, naturalness, replyLikelihood, spamRisk)
  - subject: string (the selected best subject)
  - preheader: string
  - body: string (the final selected email body)
  - cta: string
  - qualityScore: object { relevance: 0-10, commercialClarity: 0-10, offerStrength: 0-10, naturalness: 0-10, subjectQuality: 0-10, replyLikelihood: 0-10, spamRisk: 0-10 }`,
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
