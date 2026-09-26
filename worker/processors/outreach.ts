import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { GmailProvider } from "@/lib/email/gmail";
import { ResendProvider } from "@/lib/email/resend";
import type { EmailProvider } from "@/lib/email/types";
import { parseFollowUpSteps } from "@/lib/follow-ups";
import { recordActivity } from "@/lib/jobs";
import { signUnsubscribeToken } from "@/lib/session";

export async function processOutreach(messageId: string) {
  const message = await prisma.outreachMessage.findUnique({
    where: { id: messageId },
    include: { prospect: true, contact: true, campaign: { include: { emailAccount: true } } },
  });
  if (!message) throw new AppError("Outreach message was not found.");
  if (message.state === "SENT" || message.state === "DELIVERED" || message.state === "REPLIED") return;
  if (!message.contact?.email) throw new AppError("The contact does not have an email address.");
  if (message.contact.suppressed) throw new AppError("This contact is suppressed.");
  const suppressed = await prisma.suppression.findUnique({
    where: { organizationId_email: { organizationId: message.organizationId, email: message.contact.email.toLowerCase() } },
  });
  if (suppressed) {
    await prisma.outreachMessage.update({ where: { id: message.id }, data: { state: "SUPPRESSED" } });
    await prisma.prospect.update({ where: { id: message.prospectId }, data: { outreachState: "SUPPRESSED" } });
    throw new AppError("This contact is on the suppression list.");
  }
  if (!message.campaign || message.campaign.status === "PAUSED" || message.campaign.status === "ARCHIVED") {
    throw new AppError("The campaign is not allowed to send.");
  }
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const sentToday = await prisma.outreachMessage.count({
    where: { campaignId: message.campaignId, sentAt: { gte: start } },
  });
  if (sentToday >= message.campaign.dailyOutreachLimit) {
    throw new AppError("The daily outreach limit has been reached.");
  }
  const account = message.campaign.emailAccount;
  if (!account || account.status === "RESTRICTED") throw new AppError("The campaign sender is not available.");
  const provider = providerFor(account.provider, account.refreshTokenEncrypted);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://leadpilot.live";
  const unsubscribe = await signUnsubscribeToken(message.contact.id);
  const text = `${message.body.trim()}\n\nIf you would rather not hear from us, use this link: ${appUrl}/unsubscribe?token=${unsubscribe}`;
  await prisma.outreachMessage.update({ where: { id: message.id }, data: { state: "SENDING", error: null } });
  try {
    const result = await provider.sendEmail({
      to: message.contact.email,
      from: account.fromEmail,
      fromName: account.fromName,
      subject: message.subject,
      text,
    });
    await prisma.outreachMessage.update({
      where: { id: message.id },
      data: {
        state: "SENT",
        provider: account.provider,
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
        error: null,
      },
    });
    await prisma.prospect.update({ where: { id: message.prospectId }, data: { outreachState: "SENT" } });
    await createFollowUps(message.campaign.id, message.organizationId, message.prospectId, message.id, message.campaign.autoFollowUp, message.campaign.followUpSteps);
    await recordActivity({
      organizationId: message.organizationId,
      campaignId: message.campaignId,
      prospectId: message.prospectId,
      action: "outreach.sent",
      detail: account.provider,
    });
  } catch (error) {
    const permanent = error instanceof Error && error.name === "PermanentProviderError";
    await prisma.outreachMessage.update({
      where: { id: message.id },
      data: { state: "FAILED", error: error instanceof Error ? error.message.slice(0, 300) : "Send failed" },
    });
    await prisma.prospect.update({ where: { id: message.prospectId }, data: { outreachState: "FAILED" } });
    if (permanent) {
      await prisma.emailAccount.update({
        where: { id: account.id },
        data: { status: "RESTRICTED", lastError: error instanceof Error ? error.message.slice(0, 300) : "Provider stopped sending." },
      });
    }
    throw error;
  }
}

function providerFor(kind: "RESEND" | "GMAIL", encryptedRefresh: string | null): EmailProvider {
  if (kind === "RESEND") return new ResendProvider();
  if (!encryptedRefresh) throw new AppError("Gmail is not connected for this sender.");
  return new GmailProvider(decryptSecret(encryptedRefresh));
}

async function createFollowUps(
  campaignId: string,
  organizationId: string,
  prospectId: string,
  messageId: string,
  autoFollowUp: boolean,
  stepsValue: unknown,
) {
  const message = await prisma.outreachMessage.findUnique({ where: { id: messageId } });
  if (!message) return;
  const steps = parseFollowUpSteps(stepsValue);
  const now = Date.now();
  for (const step of steps) {
    const runAt = new Date(now + step.dayOffset * 24 * 60 * 60 * 1000);
    await prisma.followUp.create({
      data: {
        organizationId,
        campaignId,
        prospectId,
        messageId,
        dayOffset: step.dayOffset,
        subject: `Re: ${message.subject}`,
        body: message.body,
        state: autoFollowUp ? "SCHEDULED" : "PENDING_APPROVAL",
        runAt: autoFollowUp ? runAt : null,
      },
    });
  }
}
