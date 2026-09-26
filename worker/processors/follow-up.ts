import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { queueJob } from "@/lib/jobs";
import { isSuppressionRequest } from "@/lib/suppression";

export async function processDueFollowUps(organizationId: string) {
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
    await prisma.followUp.update({ where: { id: followUp.id }, data: { state: "QUEUED", messageId: message.id } });
    await queueJob({
      organizationId,
      campaignId: followUp.campaignId,
      prospectId: followUp.prospectId,
      queue: "outreach",
      name: "outreach.send",
      payload: { messageId: message.id },
    });
  }
}

export async function processReply(replyId: string) {
  const reply = await prisma.reply.findUnique({
    where: { id: replyId },
    include: { conversation: { include: { prospect: true } } },
  });
  if (!reply) throw new AppError("Reply was not found.");
  if (isSuppressionRequest(reply.body)) {
    if (reply.fromEmail) {
      await prisma.suppression.upsert({
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
    await prisma.contact.updateMany({
      where: { prospectId: reply.prospectId, email: reply.fromEmail ?? undefined },
      data: { suppressed: true },
    });
    await prisma.followUp.updateMany({
      where: { prospectId: reply.prospectId, state: { in: ["SCHEDULED", "PENDING_APPROVAL"] } },
      data: { state: "CANCELLED" },
    });
    await prisma.reply.update({
      where: { id: reply.id },
      data: { classification: "UNSUBSCRIBE", classificationNote: "Suppression phrase found in the reply." },
    });
    return;
  }
  const { completeJson } = await import("@/lib/ai/client");
  const { replyPrompt, PROMPTS } = await import("@/lib/ai/prompts");
  const { extractJsonObject, replyAnalysisSchema } = await import("@/lib/ai/schemas");
  const { hashInput } = await import("@/lib/ai/client");
  let lastError = "DeepSeek could not classify the reply.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await completeJson(replyPrompt(reply.body));
      const parsed = replyAnalysisSchema.parse(extractJsonObject(result.content));
      await prisma.reply.update({
        where: { id: reply.id },
        data: {
          classification: parsed.classification,
          classificationNote: parsed.note,
          suggestedSubject: parsed.suggestedSubject,
          suggestedBody: parsed.suggestedBody,
          confidence: Math.round(parsed.confidence),
        },
      });
      await prisma.aIRequest.create({
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
      if (parsed.classification === "UNSUBSCRIBE" && reply.fromEmail) {
        await prisma.suppression.upsert({
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
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (error instanceof AppError && /not configured/.test(error.message)) throw error;
    }
  }
  throw new AppError(lastError);
}
