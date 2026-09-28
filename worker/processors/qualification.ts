import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { completeJson, hashInput } from "@/lib/ai/client";
import { companyAnalysisPrompt, emailPrompt, PROMPTS } from "@/lib/ai/prompts";
import { companyAnalysisSchema, emailDraftSchema, extractJsonObject } from "@/lib/ai/schemas";
import { recordActivity } from "@/lib/jobs";
import { logInfo } from "@/lib/logger";
import { analysisRetryDecision, qualificationEvidence, qualificationWritePlan, shouldStoreQualificationDraft } from "@/lib/research/evidence";
import { QUOTA_LEASE_MS } from "@/lib/campaign-quota";
import { watchLease } from "@/lib/independent-heartbeat";

export async function processQualification(prospectId: string) {
  const prospect = await prisma.prospect.findUnique({
    where: { id: prospectId },
    include: { research: { orderBy: { createdAt: "desc" }, take: 1 }, contacts: { orderBy: { isPrimary: "desc" } }, campaign: true },
  });
  if (!prospect) throw new AppError("Prospect was not found.");
  const research = prospect.research[0];
  if (!research) throw new AppError("Research must finish before qualification.");
  if (research.fetchMethod === "blocked" || !research.excerpt) {
    throw new AppError("Website research did not return page text. Qualification was not run.");
  }
  const existingMessages = await prisma.outreachMessage.findMany({ where: { prospectId: prospect.id }, select: { state: true } });
  const assessmentCount = await prisma.opportunityAssessment.count({ where: { prospectId: prospect.id } });
  if (qualificationWritePlan({
    qualificationStatus: prospect.qualificationStatus,
    assessmentCount,
    messageStates: existingMessages.map((item) => item.state),
  }) === "skip") {
    logInfo("qualification.skipped_existing", { prospectId: prospect.id });
    return;
  }
  const slotId = await reserveQualificationSlot(prospect);
  const stopLease = slotId
    ? watchLease({ kind: "qualification", id: slotId }, () => refreshQualificationLease(slotId))
    : null;
  try {
  const sources = await prisma.discoverySource.findMany({ where: { prospectId: prospect.id }, orderBy: { createdAt: "desc" }, take: 5 });
  const evidence = qualificationEvidence({
    companyName: prospect.companyName,
    domain: prospect.domain,
    industry: prospect.industry,
    city: prospect.city,
    country: prospect.country,
    website: prospect.website,
    fetchMethod: research.fetchMethod,
    title: research.title,
    description: research.metaDescription,
    excerpt: research.excerpt,
    signals: research.signals,
    sources,
  });
  logInfo("qualification.started", { prospectId: prospect.id });
  const inputHash = hashInput(evidence);
  // A completed AIRequest stores only an input hash, not the model JSON.
  // Replaying prospect columns would replace cited evidence with empty arrays.
  const analysis = await analyze(prospect.organizationId, prospect.id, evidence, inputHash);
  const rows = (["software", "advertising", "automation"] as const).map((kind) => ({
    kind: kind === "software" ? "SOFTWARE" as const : kind === "advertising" ? "ADVERTISING" as const : "AUTOMATION" as const,
    title: kind === "software" ? "Software opportunity" : kind === "advertising" ? "Advertising opportunity" : "Automation opportunity",
    description: analysis[kind].interpretation,
    potentialValue: qualitativeValue(analysis[kind].score),
    evidence: analysis[kind].evidence,
    interpretation: analysis[kind].interpretation,
    recommendedService: kind === "software" ? analysis.recommendedService : null,
    confidence: Math.round(analysis[kind].confidence),
  }));
  const contact = prospect.contacts.find((item) => item.email && !item.suppressed);
  let storeDraft = false;
  const wrote = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prospect.id}))`;
    const fresh = await tx.prospect.findUnique({ where: { id: prospect.id } });
    const messages = await tx.outreachMessage.findMany({ where: { prospectId: prospect.id }, select: { state: true } });
    const count = await tx.opportunityAssessment.count({ where: { prospectId: prospect.id } });
    const states = messages.map((item) => item.state);
    if (!fresh || qualificationWritePlan({ qualificationStatus: fresh.qualificationStatus, assessmentCount: count, messageStates: states }) === "skip") return false;
    for (const row of rows) {
      const existing = await tx.opportunityAssessment.findFirst({ where: { prospectId: prospect.id, kind: row.kind }, orderBy: { createdAt: "asc" } });
      const kept = existing
        ? await tx.opportunityAssessment.update({ where: { id: existing.id }, data: row })
        : await tx.opportunityAssessment.create({ data: { prospectId: prospect.id, ...row } });
      await tx.opportunityAssessment.deleteMany({ where: { prospectId: prospect.id, kind: row.kind, NOT: { id: kept.id } } });
    }
    await tx.prospect.update({
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
    storeDraft = Boolean(prospect.campaign) && shouldStoreQualificationDraft(states);
    return true;
  });
  if (!wrote) {
    await releaseQualificationSlot(slotId);
    logInfo("qualification.skipped_existing", { prospectId: prospect.id });
    return;
  }
  const campaign = prospect.campaign;
  if (storeDraft && campaign) {
    const draft = await draftEmail(prospect.organizationId, prospect.id, {
      companyName: prospect.companyName,
      contactName: contact?.fullName ?? null,
      evidence: evidence.slice(0, 4000),
      angle: analysis.personalizationAngle,
      recommendedService: analysis.recommendedService,
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prospect.id}))`;
      const messages = await tx.outreachMessage.findMany({ where: { prospectId: prospect.id }, select: { state: true } });
      if (!shouldStoreQualificationDraft(messages.map((item) => item.state))) return;
      const conversation = await tx.conversation.create({
        data: {
          organizationId: prospect.organizationId,
          prospectId: prospect.id,
          subject: draft.subject,
        },
      });
      await tx.outreachMessage.create({
        data: {
          organizationId: prospect.organizationId,
          campaignId: campaign.id,
          prospectId: prospect.id,
          contactId: contact?.id,
          conversationId: conversation.id,
          subject: draft.subject,
          body: draft.body,
          state: contact?.email ? "PENDING_APPROVAL" : "DRAFT",
          provider: campaign.provider,
        },
      });
      await tx.prospect.update({
        where: { id: prospect.id },
        data: { outreachState: contact?.email ? "PENDING_APPROVAL" : "DRAFT" },
      });
    });
  }
  if (slotId) {
    await prisma.activityLog.updateMany({
      where: { id: slotId, action: "qualification.slot" },
      data: { action: "prospect.qualified", detail: analysis.recommendedService },
    });
  } else {
    await recordActivity({
      organizationId: prospect.organizationId,
      campaignId: prospect.campaignId,
      prospectId: prospect.id,
      action: "prospect.qualified",
      detail: analysis.recommendedService,
    });
  }
  logInfo("qualification.completed", { prospectId: prospect.id });
  } catch (error) {
    await releaseQualificationSlot(slotId);
    throw error;
  } finally {
    stopLease?.();
  }
}

async function reserveQualificationSlot(prospect: {
  id: string;
  organizationId: string;
  campaignId: string | null;
  campaign: { dailyQualificationLimit: number } | null;
}) {
  const campaign = prospect.campaign;
  if (!campaign || !prospect.campaignId) return null;
  const campaignId = prospect.campaignId;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qualification:${campaignId}`}))`;
    const staleBefore = new Date(Date.now() - QUOTA_LEASE_MS);
    await tx.activityLog.deleteMany({
      where: { campaignId, action: "qualification.slot", createdAt: { lt: staleBefore } },
    });
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const used = await tx.activityLog.count({
      where: {
        campaignId,
        action: { in: ["qualification.slot", "prospect.qualified"] },
        createdAt: { gte: start },
      },
    });
    if (used >= campaign.dailyQualificationLimit) {
      throw new AppError("The daily qualification quota has been reached.");
    }
    const row = await tx.activityLog.create({
      data: {
        organizationId: prospect.organizationId,
        campaignId,
        prospectId: prospect.id,
        action: "qualification.slot",
        detail: "Qualification slot reserved.",
      },
    });
    return row.id;
  });
}

async function refreshQualificationLease(slotId: string) {
  await prisma.activityLog.updateMany({
    where: { id: slotId, action: "qualification.slot" },
    data: { createdAt: new Date() },
  });
}

async function releaseQualificationSlot(slotId: string | null) {
  if (!slotId) return;
  await prisma.activityLog.deleteMany({ where: { id: slotId, action: "qualification.slot" } });
}

function qualitativeValue(score: number) {
  if (score >= 70) return "high";
  if (score >= 40) return "moderate";
  if (score > 0) return "low";
  return "unknown";
}

async function analyze(organizationId: string, prospectId: string, evidence: string, inputHash: string) {
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
      logInfo("qualification.validation_failed", { prospectId, attempt, message: lastError.slice(0, 180) });
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
      const decision = analysisRetryDecision(attempt, lastError);
      if (decision === "stop") throw error;
      if (decision === "fail") break;
    }
  }
  throw new AppError("DeepSeek returned malformed qualification JSON.");
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
