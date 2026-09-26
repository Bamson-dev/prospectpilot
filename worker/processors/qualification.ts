import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { completeJson, hashInput } from "@/lib/ai/client";
import { companyAnalysisPrompt, emailPrompt, PROMPTS } from "@/lib/ai/prompts";
import { companyAnalysisSchema, emailDraftSchema, extractJsonObject, type CompanyAnalysis } from "@/lib/ai/schemas";
import { recordActivity } from "@/lib/jobs";

export async function processQualification(prospectId: string) {
  const prospect = await prisma.prospect.findUnique({
    where: { id: prospectId },
    include: { research: { orderBy: { createdAt: "desc" }, take: 1 }, contacts: { orderBy: { isPrimary: "desc" } }, campaign: true },
  });
  if (!prospect) throw new AppError("Prospect was not found.");
  const research = prospect.research[0];
  if (!research) throw new AppError("Research must finish before qualification.");
  const evidence = [
    `Company: ${prospect.companyName}`,
    prospect.website ? `Website: ${prospect.website}` : "",
    research.title ? `Title: ${research.title}` : "",
    research.metaDescription ? `Description: ${research.metaDescription}` : "",
    research.excerpt ? `Page text: ${research.excerpt.slice(0, 5000)}` : "",
    `Signals: ${JSON.stringify(research.signals).slice(0, 2000)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const inputHash = hashInput(evidence);
  const cached = await prisma.aIRequest.findFirst({
    where: { organizationId: prospect.organizationId, purpose: PROMPTS.companyAnalysis, inputHash, status: "completed" },
  });
  const analysis = cached
    ? await analyze(prospect.organizationId, prospect.id, evidence, inputHash, true)
    : await analyze(prospect.organizationId, prospect.id, evidence, inputHash, false);

  await prisma.opportunityAssessment.deleteMany({ where: { prospectId: prospect.id } });
  await prisma.opportunityAssessment.createMany({
    data: (["software", "advertising", "automation"] as const).map((kind) => ({
      prospectId: prospect.id,
      kind: kind === "software" ? "SOFTWARE" : kind === "advertising" ? "ADVERTISING" : "AUTOMATION",
      evidence: analysis[kind].evidence,
      interpretation: analysis[kind].interpretation,
      recommendedService: kind === "software" ? analysis.recommendedService : null,
      confidence: Math.round(analysis[kind].confidence),
    })),
  });
  await prisma.prospect.update({
    where: { id: prospect.id },
    data: {
      qualificationStatus: "QUALIFIED",
      researchSummary: analysis.summary,
      painPoints: analysis.painPoints,
      opportunityScore: Math.round(analysis.opportunityScore),
      opportunityReason: analysis.opportunityReason,
      recommendedService: analysis.recommendedService,
      personalizationAngle: analysis.personalizationAngle,
      suggestedOpening: analysis.suggestedOpening,
      softwareOpportunity: Math.round(analysis.software.score),
      advertisingOpportunity: Math.round(analysis.advertising.score),
      automationOpportunity: Math.round(analysis.automation.score),
    },
  });
  const contact = prospect.contacts.find((item) => item.email && !item.suppressed);
  if (contact?.email && prospect.campaign) {
    const draft = await draftEmail(prospect.organizationId, prospect.id, {
      companyName: prospect.companyName,
      contactName: contact.fullName,
      evidence: evidence.slice(0, 4000),
      angle: analysis.personalizationAngle,
      recommendedService: analysis.recommendedService,
    });
    const conversation = await prisma.conversation.create({
      data: {
        organizationId: prospect.organizationId,
        prospectId: prospect.id,
        subject: draft.subject,
      },
    });
    await prisma.outreachMessage.create({
      data: {
        organizationId: prospect.organizationId,
        campaignId: prospect.campaignId,
        prospectId: prospect.id,
        contactId: contact.id,
        conversationId: conversation.id,
        subject: draft.subject,
        body: draft.body,
        state: "PENDING_APPROVAL",
        provider: prospect.campaign.provider,
      },
    });
    await prisma.prospect.update({ where: { id: prospect.id }, data: { outreachState: "PENDING_APPROVAL" } });
  }
  await recordActivity({
    organizationId: prospect.organizationId,
    campaignId: prospect.campaignId,
    prospectId: prospect.id,
    action: "prospect.qualified",
    detail: analysis.recommendedService,
  });
}

async function analyze(organizationId: string, prospectId: string, evidence: string, inputHash: string, reuse: boolean) {
  if (reuse) {
    const prior = await prisma.aIRequest.findFirst({
      where: { prospectId, purpose: PROMPTS.companyAnalysis, inputHash, status: "completed" },
      orderBy: { createdAt: "desc" },
    });
    if (prior) {
      const prospect = await prisma.prospect.findUnique({ where: { id: prospectId } });
      if (prospect?.researchSummary && prospect.opportunityReason && prospect.recommendedService) {
        return {
          summary: prospect.researchSummary,
          painPoints: prospect.painPoints,
          opportunityScore: prospect.opportunityScore ?? 0,
          opportunityReason: prospect.opportunityReason,
          recommendedService: prospect.recommendedService,
          personalizationAngle: prospect.personalizationAngle ?? prospect.opportunityReason,
          suggestedOpening: prospect.suggestedOpening ?? prospect.opportunityReason,
          software: { score: prospect.softwareOpportunity ?? 0, interpretation: prospect.opportunityReason, confidence: 50, evidence: [] },
          advertising: { score: prospect.advertisingOpportunity ?? 0, interpretation: prospect.opportunityReason, confidence: 50, evidence: [] },
          automation: { score: prospect.automationOpportunity ?? 0, interpretation: prospect.opportunityReason, confidence: 50, evidence: [] },
        } satisfies CompanyAnalysis;
      }
    }
  }
  const messages = companyAnalysisPrompt(evidence);
  let lastError = "DeepSeek returned malformed JSON.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = Date.now();
    try {
      const result = await completeJson(messages);
      const parsed = companyAnalysisSchema.parse(extractJsonObject(result.content));
      await prisma.aIRequest.create({
        data: {
          organizationId,
          prospectId,
          purpose: PROMPTS.companyAnalysis,
          promptVersion: PROMPTS.companyAnalysis,
          model: result.model,
          inputHash,
          status: "completed",
          durationMs: result.durationMs,
        },
      });
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      await prisma.aIRequest.create({
        data: {
          organizationId,
          prospectId,
          purpose: PROMPTS.companyAnalysis,
          promptVersion: PROMPTS.companyAnalysis,
          model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
          inputHash,
          status: "failed",
          error: lastError.slice(0, 300),
          durationMs: Date.now() - started,
        },
      });
      if (error instanceof AppError && /not configured/.test(error.message)) throw error;
    }
  }
  throw new AppError(lastError);
}

async function draftEmail(
  organizationId: string,
  prospectId: string,
  input: { companyName: string; contactName: string | null; evidence: string; angle: string | null; recommendedService: string | null },
) {
  const messages = emailPrompt(input);
  const inputHash = hashInput(JSON.stringify(input));
  let lastError = "DeepSeek could not draft the email.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await completeJson(messages);
      const parsed = emailDraftSchema.parse(extractJsonObject(result.content));
      await prisma.aIRequest.create({
        data: {
          organizationId,
          prospectId,
          purpose: PROMPTS.emailGeneration,
          promptVersion: PROMPTS.emailGeneration,
          model: result.model,
          inputHash,
          status: "completed",
          durationMs: result.durationMs,
        },
      });
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (error instanceof AppError && /not configured/.test(error.message)) throw error;
    }
  }
  throw new AppError(lastError);
}
