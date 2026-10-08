import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { completeJson, hashInput } from "@/lib/ai/client";
import { companyAnalysisPrompt, emailPrompt, PROMPTS } from "@/lib/ai/prompts";
import { companyAnalysisSchema, emailDraftSchema, extractJsonObject, type EmailDraft } from "@/lib/ai/schemas";
import { queueJob, recordActivity } from "@/lib/jobs";
import { logInfo } from "@/lib/logger";
import { analysisRetryDecision, qualificationEvidence, qualificationWritePlan, shouldStoreQualificationDraft } from "@/lib/research/evidence";
import { QUOTA_LEASE_MS } from "@/lib/campaign-quota";
import { watchLease } from "@/lib/independent-heartbeat";
import { rankOpportunities, assessSalesDraft, unsupportedEvidenceClaims } from "@/lib/sales/intelligence";

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
    ? watchLease({ kind: "qualification", id: slotId })
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
  const rankedOpportunities = rankOpportunities(analysis.opportunities);
  const primaryOpportunity = rankedOpportunities[0] ?? null;
  const recommendedService = primaryOpportunity?.serviceMatch || analysis.recommendedService;
  const personalizationAngle = primaryOpportunity?.recommendedAngle || analysis.personalizationAngle;
  const salesIntelligence = {
    companyProfile: analysis.companyProfile,
    rankedOpportunities,
    alternateAngles: rankedOpportunities.slice(1).map((item) => ({
      title: item.title,
      angle: item.recommendedAngle,
      service: item.serviceMatch,
      evidence: item.evidence,
    })),
  };
  const rows = (["software", "advertising", "automation"] as const).map((kind) => ({
    kind: kind === "software" ? "SOFTWARE" as const : kind === "advertising" ? "ADVERTISING" as const : "AUTOMATION" as const,
    title: kind === "software" ? "Software opportunity" : kind === "advertising" ? "Advertising opportunity" : "Automation opportunity",
    description: analysis[kind].interpretation,
    potentialValue: qualitativeValue(analysis[kind].score),
    evidence: analysis[kind].evidence,
    interpretation: analysis[kind].interpretation,
    recommendedService: primaryOpportunity && opportunityCategory(primaryOpportunity.type) === rowCategory(kind) ? recommendedService : null,
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
        recommendedService,
        personalizationAngle,
        suggestedOpening: analysis.suggestedOpening,
        salesIntelligence,
        softwareOpportunity: Math.round(analysis.software.score),
        advertisingOpportunity: Math.round(analysis.advertising.score),
        automationOpportunity: Math.round(analysis.automation.score),
      },
    });
    storeDraft = Boolean(prospect.campaign) && Boolean(primaryOpportunity) && shouldStoreQualificationDraft(states);
    return true;
  });
  if (!wrote) {
    await releaseQualificationSlot(slotId);
    logInfo("qualification.skipped_existing", { prospectId: prospect.id });
    return;
  }
  const campaign = prospect.campaign;
  if (storeDraft && campaign) {
    let draft: EmailDraft | null = null;
    try {
      draft = await draftEmail(prospect.organizationId, prospect.id, {
        companyName: prospect.companyName,
        contactName: contact?.fullName ?? null,
        evidence: evidence.slice(0, 6000),
        angle: personalizationAngle,
        recommendedService,
        opportunities: rankedOpportunities.slice(0, 5).map(({ title, evidence: items, recommendedAngle, serviceMatch }) => ({
          title,
          evidence: items,
          recommendedAngle,
          serviceMatch,
        })),
      });
    } catch (error) {
      logInfo("qualification.draft_skipped", {
        prospectId: prospect.id,
        reason: error instanceof Error ? error.message.slice(0, 160) : "draft_generation_failed",
      });
    }
    if (draft) {
    const wroteMessage = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prospect.id}))`;
      const messages = await tx.outreachMessage.findMany({ where: { prospectId: prospect.id }, select: { state: true } });
      if (!shouldStoreQualificationDraft(messages.map((item) => item.state))) return null;
      const conversation = await tx.conversation.create({
        data: {
          organizationId: prospect.organizationId,
          prospectId: prospect.id,
          subject: draft.subject,
        },
      });
      const targetState = contact?.email ? (campaign.requireApproval ? "PENDING_APPROVAL" : "APPROVED") : "DRAFT";
      
      const message = await tx.outreachMessage.create({
        data: {
          organizationId: prospect.organizationId,
          campaignId: campaign.id,
          prospectId: prospect.id,
          contactId: contact?.id,
          conversationId: conversation.id,
          subject: draft.subject,
          body: draft.body,
          state: targetState,
          provider: campaign.provider,
        },
      });
      await tx.prospect.update({
        where: { id: prospect.id },
        data: { outreachState: targetState },
      });
      return { messageId: message.id, state: targetState };
    });
    
    if (wroteMessage && wroteMessage.state === "APPROVED") {
      await queueJob({
        id: `outreach-${wroteMessage.messageId}`,
        organizationId: prospect.organizationId,
        queue: "outreach",
        name: "outreach.send",
        payload: { messageId: wroteMessage.messageId },
      });
    }
    }
  }
  if (slotId) {
    await prisma.activityLog.updateMany({
      where: { id: slotId, action: "qualification.slot" },
      data: { action: "prospect.qualified", detail: recommendedService },
    });
  } else {
    await recordActivity({
      organizationId: prospect.organizationId,
      campaignId: prospect.campaignId,
      prospectId: prospect.id,
      action: "prospect.qualified",
      detail: recommendedService,
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

function opportunityCategory(type: string) {
  if (type === "OTHER") return "OTHER";
  if (type === "AUTOMATION") return "AUTOMATION";
  if (type === "ADVERTISING_MANAGEMENT" || type === "ADVERTISING_OPTIMIZATION") return "ADVERTISING";
  return "SOFTWARE";
}

function rowCategory(kind: "software" | "advertising" | "automation") {
  return kind === "software" ? "SOFTWARE" : kind === "advertising" ? "ADVERTISING" : "AUTOMATION";
}

async function analyze(organizationId: string, prospectId: string, evidence: string, inputHash: string) {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    throw new AppError("AI integration not configured. Qualification was not fabricated.");
  }
  let lastError = "DeepSeek returned malformed JSON.";
  let retryFeedback = "Correct schema lengths and cite only evidence directly supported by the supplied research.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = Date.now();
    try {
      const result = await completeJson(companyAnalysisPrompt(
        evidence,
        attempt === 1,
        attempt === 1 ? retryFeedback : undefined,
      ));
      const parsed = companyAnalysisSchema.parse(extractJsonObject(result.content));
      const unsupported = unsupportedEvidenceClaims(parsed, evidence);
      if (unsupported.length > 0) throw new Error(`AI evidence provenance failed for ${unsupported.length} claim(s).`);
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
      retryFeedback = qualificationRetryFeedback(error);
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

export function qualificationRetryFeedback(error: unknown) {
  if (error instanceof Error && error.message.startsWith("AI evidence provenance failed")) {
    const match = error.message.match(/(\d+) claim/);
    return `Evidence provenance validation rejected ${match?.[1] ?? "some"} evidence items. Cite only exact phrases or close paraphrases from the supplied research; omit unsupported evidence and lower confidence.`;
  }
  if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
    const paths = error.issues
      .map((issue: { path?: unknown[] }) => issue.path?.filter((part) => typeof part === "string" || typeof part === "number").join("."))
      .filter(Boolean)
      .slice(0, 8);
    return `Schema validation failed${paths.length ? ` at: ${paths.join(", ")}` : ""}. Return valid complete JSON and obey every field length limit, including 300 characters for businessModel and each growthSignals/digitalSignals item, and 400 characters for personalizationAngle.`;
  }
  if (error instanceof Error && /enum/i.test(error.message)) {
    return "Schema validation rejected an enum value. Use only the exact allowed category codes for opportunity type and exact catalogue names for service fields.";
  }
  return "The previous response failed structured validation. Return complete JSON, obey every field length limit, and cite only evidence directly supported by the supplied research.";
}

async function draftEmail(
  organizationId: string,
  prospectId: string,
  input: {
    companyName: string;
    contactName: string | null;
    evidence: string;
    angle: string | null;
    recommendedService: string | null;
    opportunities: Array<{ title: string; evidence: string[]; recommendedAngle: string; serviceMatch: string }>;
  },
): Promise<EmailDraft> {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new AppError("AI integration not configured.");
  const inputHash = hashInput(JSON.stringify(input));
  let lastError = "DeepSeek could not draft a message that passed quality control.";
  const approaches = ["OPPORTUNITY", "PROBLEM", "CURIOSITY"] as const;

  for (let attempt = 0; attempt < approaches.length; attempt += 1) {
    const started = Date.now();
    try {
      const result = await completeJson(emailPrompt({ ...input, retryApproach: approaches[attempt] }));
      const parsed = emailDraftSchema.parse(extractJsonObject(result.content));
      const quality = assessSalesDraft(parsed, input.evidence);
      if (!quality.accepted) {
        lastError = `Draft failed quality control: ${quality.reasons.join(",")}`;
        await prisma.aIRequest.create({
          data: {
            organizationId,
            prospectId,
            purpose: PROMPTS.emailGeneration,
            promptVersion: PROMPTS.emailGeneration,
            model: result.model,
            inputHash,
            status: "failed",
            error: lastError.slice(0, 300),
            durationMs: result.durationMs,
          },
        });
        logInfo("outreach.draft_quality_rejected", { prospectId, attempt, reasons: quality.reasons });
        continue;
      }
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
      await prisma.aIRequest.create({
        data: {
          organizationId,
          prospectId,
          purpose: PROMPTS.emailGeneration,
          promptVersion: PROMPTS.emailGeneration,
          model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
          inputHash,
          status: "failed",
          error: lastError.slice(0, 300),
          durationMs: Date.now() - started,
        },
      });
      logInfo("outreach.draft_validation_failed", { prospectId, attempt });
    }
  }
  throw new AppError(lastError);
}
