import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { replyWorkDecision } from "@/lib/email/message-policy";
import { outreachSendingEnabled } from "@/lib/email/send-gate";
import { AppError } from "@/lib/errors";
import { queueJob } from "@/lib/jobs";
import { isSuppressionRequest } from "@/lib/suppression";

export async function processDueFollowUps(organizationId: string) {
  if (!outreachSendingEnabled()) return;
  const due = await prisma.followUp.findMany({
    where: { organizationId, state: "SCHEDULED", runAt: { lte: new Date() } },
    take: 20,
    include: { campaign: true },
  });
  for (const followUp of due) {
    const prospect = await prisma.prospect.findUnique({
      where: { id: followUp.prospectId },
      include: { contacts: true, conversations: { include: { replies: true } } },
    });
    if (!prospect || followUp.campaign.status === "PAUSED" || followUp.campaign.status === "ARCHIVED") {
      await prisma.followUp.update({ where: { id: followUp.id }, data: { state: "CANCELLED" } });
      continue;
    }
    const replied = prospect.conversations.some((conversation) => conversation.replies.length > 0);
    const contact = prospect.contacts.find((item) => item.isPrimary) ?? prospect.contacts[0];
    if (replied || contact?.suppressed) {
      await prisma.followUp.update({ where: { id: followUp.id }, data: { state: "CANCELLED" } });
      continue;
    }
    const claim = await prisma.followUp.updateMany({
      where: { id: followUp.id, state: "SCHEDULED" },
      data: { state: "QUEUED" },
    });
    if (claim.count !== 1) continue;
    let messageId: string | null = null;
    try {
      const message = await prisma.outreachMessage.create({
        data: {
          organizationId,
          campaignId: followUp.campaignId,
          prospectId: followUp.prospectId,
          contactId: contact?.id,
          subject: followUp.subject,
          body: followUp.body,
          state: "APPROVED",
          provider: followUp.campaign.provider,
        },
      });
      messageId = message.id;
      await prisma.followUp.updateMany({
        where: { id: followUp.id, state: "QUEUED" },
        data: { messageId: message.id },
      });
      await queueJob({
        organizationId,
        campaignId: followUp.campaignId,
        prospectId: followUp.prospectId,
        queue: "outreach",
        name: "outreach.send",
        payload: { messageId: message.id },
      });
    } catch (error) {
      if (!messageId) {
        await prisma.followUp.updateMany({
          where: { id: followUp.id, state: "QUEUED", messageId: null },
          data: { state: "SCHEDULED" },
        });
      }
      throw error;
    }
  }
}

export async function processReply(replyId: string) {
  const reply = await prisma.reply.findUnique({ where: { id: replyId } });
  if (!reply) throw new AppError("Reply was not found.");
  if (replyWorkDecision(reply.classification, isSuppressionRequest(reply.body)) === "skip") return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reply-classify:${reply.id}`}))`;
    const current = await tx.reply.findUnique({ where: { id: reply.id }, select: { classification: true } });
    if (!current) return;
    const decision = replyWorkDecision(current.classification, isSuppressionRequest(reply.body));
    if (decision === "skip") return;
    if (decision === "suppress") {
      await suppressReply(tx, reply);
      return;
    }
    await classifyReply(tx, reply);
  }, { maxWait: 80_000, timeout: 80_000 });
}

async function suppressReply(tx: Prisma.TransactionClient, reply: { id: string; organizationId: string; prospectId: string; fromEmail: string | null }) {
  if (reply.fromEmail) {
    await tx.suppression.upsert({
      where: { organizationId_email: { organizationId: reply.organizationId, email: reply.fromEmail.toLowerCase() } },
      update: { reason: "Reply asked to stop contact.", source: "reply" },
      create: {
        organizationId: reply.organizationId,
        email: reply.fromEmail.toLowerCase(),
        reason: "Reply asked to stop contact.",
        source: "reply",
      },
    });
  }
  await tx.contact.updateMany({
    where: { prospectId: reply.prospectId, email: reply.fromEmail ?? undefined },
    data: { suppressed: true },
  });
  await tx.followUp.updateMany({
    where: { prospectId: reply.prospectId, state: { in: ["SCHEDULED", "PENDING_APPROVAL"] } },
    data: { state: "CANCELLED" },
  });
  await tx.reply.update({
    where: { id: reply.id },
    data: { classification: "UNSUBSCRIBE", classificationNote: "Suppression phrase found in the reply." },
  });
}

async function classifyReply(tx: Prisma.TransactionClient, reply: { id: string; organizationId: string; prospectId: string; fromEmail: string | null; body: string }) {
  const { completeJson, hashInput } = await import("@/lib/ai/client");
  const { replyPrompt, PROMPTS } = await import("@/lib/ai/prompts");
  const { extractJsonObject, replyAnalysisSchema } = await import("@/lib/ai/schemas");
  let lastError = "DeepSeek could not classify the reply.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await completeJson(replyPrompt(reply.body));
      const parsed = replyAnalysisSchema.parse(extractJsonObject(result.content));
      await tx.reply.update({
        where: { id: reply.id },
        data: {
          classification: parsed.classification,
          classificationNote: parsed.note,
          suggestedSubject: parsed.suggestedSubject,
          suggestedBody: parsed.suggestedBody,
          confidence: Math.round(parsed.confidence),
        },
      });
      if (parsed.classification === "UNSUBSCRIBE" && reply.fromEmail) {
        await tx.suppression.upsert({
          where: { organizationId_email: { organizationId: reply.organizationId, email: reply.fromEmail.toLowerCase() } },
          update: {},
          create: {
            organizationId: reply.organizationId,
            email: reply.fromEmail.toLowerCase(),
            reason: "Classified as an unsubscribe request.",
            source: "reply-classification",
          },
        });
      }
      await tx.aIRequest.create({
        data: {
          organizationId: reply.organizationId,
          prospectId: reply.prospectId,
          purpose: PROMPTS.replyClassification,
          promptVersion: PROMPTS.replyClassification,
          model: result.model,
          inputHash: hashInput(reply.body),
          status: "completed",
          durationMs: result.durationMs,
        },
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (error instanceof AppError && /not configured/.test(error.message)) throw error;
    }
  }
  throw new AppError(lastError);
}
