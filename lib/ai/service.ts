import { AppError } from "@/lib/errors";
import { completeJson } from "@/lib/ai/client";
import { companyAnalysisPrompt, emailPrompt, replyPrompt } from "@/lib/ai/prompts";
import { companyAnalysisSchema, emailDraftSchema, extractJsonObject, replyAnalysisSchema } from "@/lib/ai/schemas";

export function aiConfigured() {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
}

function requireAi() {
  if (!aiConfigured()) throw new AppError("AI integration not configured");
}

export async function analyzeCompany(evidence: string) {
  requireAi();
  const result = await completeJson(companyAnalysisPrompt(evidence));
  return companyAnalysisSchema.parse(extractJsonObject(result.content));
}

export async function qualifyProspect(evidence: string) {
  return analyzeCompany(evidence);
}

export async function identifyOpportunities(evidence: string) {
  const analysis = await analyzeCompany(evidence);
  return {
    software: analysis.software,
    advertising: analysis.advertising,
    automation: analysis.automation,
  };
}

export async function generatePitch(evidence: string) {
  const analysis = await analyzeCompany(evidence);
  return {
    angle: analysis.personalizationAngle,
    opening: analysis.suggestedOpening,
    service: analysis.recommendedService,
  };
}

export async function generateEmail(input: {
  companyName: string;
  contactName: string | null;
  evidence: string;
  angle: string | null;
  recommendedService: string | null;
}) {
  requireAi();
  const result = await completeJson(emailPrompt(input));
  return emailDraftSchema.parse(extractJsonObject(result.content));
}

export async function classifyReply(body: string) {
  const analysis = await summarizeReply(body);
  return analysis.classification;
}

export async function generateReply(body: string) {
  const analysis = await summarizeReply(body);
  return { subject: analysis.suggestedSubject, body: analysis.suggestedBody };
}

export async function summarizeResearch(evidence: string) {
  const analysis = await analyzeCompany(evidence);
  return analysis.summary;
}

async function summarizeReply(body: string) {
  requireAi();
  const result = await completeJson(replyPrompt(body));
  return replyAnalysisSchema.parse(extractJsonObject(result.content));
}
