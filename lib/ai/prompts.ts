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
      content: `Prompt ${PROMPTS.companyAnalysis}\n\nResearch evidence:\n${evidence}\n\nReturn JSON with keys: summary (string), painPoints (string array, max 4), opportunityScore (integer 0-100), opportunityReason (string), recommendedService (string), personalizationAngle (string), suggestedOpening (string), software (object with score 0-100, interpretation, confidence 0-100, evidence string array), advertising (same object shape), automation (same object shape). Evidence strings must quote or closely paraphrase the supplied research.`,
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
      content:
        "Write a short B2B email using only the supplied evidence. Do not invent observations. Do not use 'Dear Sir/Madam' or 'Hope you are doing well'. Return only JSON with subject and body. The body is plain text.",
    },
    {
      role: "user" as const,
      content: `Prompt ${PROMPTS.emailGeneration}\nCompany: ${input.companyName}\nContact: ${input.contactName ?? "unknown"}\nRecommended service: ${input.recommendedService ?? "unknown"}\nAngle: ${input.angle ?? "unknown"}\nEvidence:\n${input.evidence}`,
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
