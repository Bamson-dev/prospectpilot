import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { GmailProvider } from "@/lib/email/gmail";
import { ResendProvider } from "@/lib/email/resend";
import { outreachSendDecision } from "@/lib/email/message-policy";
import { outreachSendingEnabled } from "@/lib/email/send-gate";
import { reserveRecipientSend } from "@/lib/email/send-reservation";

import type { EmailProvider } from "@/lib/email/types";
import { parseFollowUpSteps } from "@/lib/follow-ups";
import { recordActivity } from "@/lib/jobs";
import { signUnsubscribeToken } from "@/lib/session";
import { assertSafeOutboundCopy } from "@/lib/sales/intelligence";
import { buildFollowUpCopy } from "@/lib/sales/follow-up-copy";

export async function processOutreach(messageId: string) {
  if (!outreachSendingEnabled()) throw new AppError("Outbound sending is turned off.");

  const message = await prisma.outreachMessage.findUnique({
    where: { id: messageId },
    include: { prospect: true, contact: true, campaign: { include: { emailAccount: true } } },
  });
  if (!message) throw new AppError("Outreach message was not found.");
  const decision = outreachSendDecision(message.state);
  if (decision === "already-sent" || decision === "do-not-resend") return;
  if (decision === "refuse") throw new AppError("This message is not approved to send.");
  if (!message.contact?.email) throw new AppError("The contact does not have an email address.");
  try {
    assertSafeOutboundCopy(message.subject, message.body);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Message failed outbound content safety.";
    await prisma.outreachMessage.updateMany({
      where: { id: message.id, state: { in: ["APPROVED", "QUEUED", "FAILED"] } },
      data: { state: "FAILED", error: reason.slice(0, 300) },
    });
    await prisma.prospect.update({ where: { id: message.prospectId }, data: { outreachState: "FAILED" } });
    throw new AppError(reason);
  }
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
    throw new AppError("The daily outreach limit has been reached for this campaign.");
  }

  const account = message.campaign.emailAccount;
  if (!account || account.status === "RESTRICTED") throw new AppError("The campaign sender is not available.");

  const accountSentToday = await prisma.outreachMessage.count({
    where: { campaign: { emailAccountId: account.id }, sentAt: { gte: start } },
  });
  if (accountSentToday >= 40) {
    throw new AppError("The safety limit for this sender account has been reached today.");
  }

  const systemSentToday = await prisma.outreachMessage.count({
    where: { sentAt: { gte: start } },
  });
  if (systemSentToday >= 200) {
    throw new AppError("The global system outreach limit has been reached today.");
  }

  const provider = providerFor(account.provider, account.refreshTokenEncrypted);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://leadpilot.live";
  const unsubscribe = await signUnsubscribeToken(message.contact.id);
  const text = `${message.body.trim()}\n\nIf you'd rather not receive emails from me, unsubscribe here: ${appUrl}/unsubscribe?token=${unsubscribe}`;
  const html = `${message.body.trim().replace(/\n/g, "<br/>")}<br/><br/>If you'd rather not receive emails from me, <a href="${appUrl}/unsubscribe?token=${unsubscribe}">unsubscribe here</a>.`;
  const reservation = await reserveRecipientSend(prisma, {
    messageId: message.id,
    organizationId: message.organizationId,
    email: message.contact.email,
  });
  if (reservation === "duplicate-recipient") throw new AppError("This address was already contacted by another message.");
  if (reservation !== "claimed") return;
  try {
    const result = await provider.sendEmail({
      to: message.contact.email,
      from: account.fromEmail,
      fromName: account.fromName,
      subject: message.subject,
      text,
      html,
    });
    const sent = await prisma.outreachMessage.updateMany({
      where: { id: message.id, state: "SENDING" },
      data: {
        state: "SENT",
        provider: account.provider,
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
        error: null,
      },
    });
    if (sent.count !== 1) return;
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
    const reason = error instanceof Error ? error.message.slice(0, 300) : "Send failed";
    if (permanent) {
      // The provider rejected the message, so it provably was not sent.
      await prisma.outreachMessage.updateMany({ where: { id: message.id, state: "SENDING" }, data: { state: "FAILED", error: reason } });
      await prisma.prospect.update({ where: { id: message.prospectId }, data: { outreachState: "FAILED" } });
      await prisma.emailAccount.update({
        where: { id: account.id },
        data: { status: "RESTRICTED", lastError: error instanceof Error ? error.message.slice(0, 300) : "Provider stopped sending." },
      });
    } else {
      // A timeout or server error does not prove the email was not delivered. Keep SENDING so no
      // retry or sibling message reaches the same address until someone reconciles it.
      await prisma.outreachMessage.updateMany({ where: { id: message.id, state: "SENDING" }, data: { error: `Delivery unconfirmed: ${reason}`.slice(0, 300) } });
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
  const prospect = await prisma.prospect.findUnique({ where: { id: prospectId }, select: { companyName: true, salesIntelligence: true, contacts: { where: { isPrimary: true }, take: 1, select: { fullName: true } } } });
  const sales = prospect?.salesIntelligence;
  const alternateAngles = sales && typeof sales === "object" && !Array.isArray(sales)
    ? (sales as { alternateAngles?: unknown }).alternateAngles
    : null;
  if (!prospect || !Array.isArray(alternateAngles) || alternateAngles.length === 0) return;
  const steps = parseFollowUpSteps(stepsValue);
  const now = Date.now();
  const usableAngles = alternateAngles
    .map((angle) => buildFollowUpCopy(prospect.companyName, prospect.contacts[0]?.fullName ?? null, angle as Parameters<typeof buildFollowUpCopy>[2]))
    .filter((item): item is NonNullable<typeof item> => item !== null);
  for (const [index, step] of steps.slice(0, usableAngles.length).entries()) {
    const copy = usableAngles[index];
    if (!copy) continue;
    const runAt = new Date(now + step.dayOffset * 24 * 60 * 60 * 1000);
    await prisma.followUp.create({
      data: {
        organizationId,
        campaignId,
        prospectId,
        messageId,
        dayOffset: step.dayOffset,
        subject: copy.subject,
        body: copy.body,
        state: autoFollowUp ? "SCHEDULED" : "PENDING_APPROVAL",
        runAt: autoFollowUp ? runAt : null,
      },
    });
  }
}
