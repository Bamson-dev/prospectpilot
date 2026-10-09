import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { classifyJobId, gmailReplyId, inboxImportDecision } from "@/lib/email/message-policy";
import { AppError } from "@/lib/errors";
import { classifyProviderFailure, isPermanentProviderFailure } from "@/lib/provider-errors";
import { queueJob } from "@/lib/jobs";
import {
  applyGmailBounce,
  gmailDeliveryStatusText,
  isBounceSender,
  noticeAuthenticationFailed,
  originalMessageIds,
  parseGmailBounce,
  sentMessageMatchesNotice,
  type GmailPart,
} from "@/lib/email/gmail-bounce";

export async function processInboxSync(organizationId: string) {
  const accounts = await prisma.emailAccount.findMany({
    where: { organizationId, provider: "GMAIL", status: "ACTIVE", refreshTokenEncrypted: { not: null } },
  });
  if (accounts.length === 0) throw new AppError("No connected Gmail account is available to sync.");
  for (const account of accounts) {
    if (!account.refreshTokenEncrypted) continue;
    const accessToken = await gmailAccessToken(decryptSecret(account.refreshTokenEncrypted));
    const list = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=in:inbox", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!list.ok) {
      const body = await list.text().catch(() => "");
      const kind = classifyProviderFailure(list.status, body);
      if (isPermanentProviderFailure(kind)) {
        await prisma.emailAccount.update({
          where: { id: account.id },
          data: { status: "RESTRICTED", lastError: `Inbox sync restricted: ${kind}` },
        });
      }
      throw new AppError(`Gmail inbox sync failed with status ${list.status}.`);
    }
    const payload = (await list.json()) as { messages?: Array<{ id: string }> };
    for (const item of payload.messages ?? []) {
      await importGmailMessage(organizationId, accessToken, item.id);
    }
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { lastSyncAt: new Date() }
    });
  }
}

async function importGmailMessage(organizationId: string, accessToken: string, messageId: string) {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20000) },
  );
  if (!response.ok) return;
  const payload = (await response.json()) as {
    snippet?: string;
    payload?: { headers?: Array<{ name: string; value: string }> };
  };
  const headers = payload.payload?.headers ?? [];
  const from = headers.find((header) => header.name.toLowerCase() === "from")?.value ?? "";
  const subject = headers.find((header) => header.name.toLowerCase() === "subject")?.value ?? "";
  const email = from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
  if (!email) return;
  if (isBounceSender(from)) {
    await importGmailBounce(organizationId, accessToken, messageId);
    return;
  }
  const contact = await prisma.contact.findFirst({
    where: { organizationId, email },
    include: { prospect: true },
  });
  
  if (!contact) {
    // Attempt to match EmployerReply for a JobApplication
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain) return;
    const application = await prisma.jobApplication.findFirst({
      where: {
        organizationId,
        vacancy: {
          OR: [
            { companyDomain: domain },
            { applicationUrl: { contains: domain } }
          ]
        }
      },
      include: { vacancy: true },
      orderBy: { createdAt: "desc" }
    });
    
    if (application) {
      const replyId = gmailReplyId(messageId) || messageId;
      const stored = await prisma.employerReply.findUnique({ where: { messageId: replyId } });
      if (stored) return;
      
      const reply = await prisma.employerReply.create({
        data: {
          organizationId,
          applicationId: application.id,
          messageId: replyId,
          threadId: payload.payload?.headers?.find(h => h.name.toLowerCase() === "thread-id")?.value || replyId,
          fromEmail: email,
          fromName: from.replace(/<[^>]+>/g, "").trim(),
          subject,
          body: payload.snippet || "(No preview returned)",
        }
      });
      
      await prisma.applicationEvent.create({
        data: {
          applicationId: application.id,
          type: "EMPLOYER_REPLY_RECEIVED",
          detail: `Received reply from ${email}: ${subject}`
        }
      });

      // Optionally queue a job for AI classification of this reply.
      await queueJob({
        id: `employer-reply-classify-${reply.id}`,
        organizationId,
        prospectId: application.candidateId, // reuse field or use separate queue
        queue: "employer-reply",
        name: "employer_reply.classify",
        payload: { replyId: reply.id },
      });
    }
    return;
  }

  const replyId = gmailReplyId(messageId);
  const stored = replyId ? await prisma.reply.findUnique({ where: { id: replyId }, select: { id: true } }) : null;
  if (inboxImportDecision(messageId, stored ? [stored.id] : []) !== "store") return;
  let conversation = await prisma.conversation.findFirst({
    where: { prospectId: contact.prospectId },
    orderBy: { updatedAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { organizationId, prospectId: contact.prospectId, subject: subject || contact.prospect.companyName },
    });
  }
  let reply: { id: string };
  try {
    reply = await prisma.reply.create({
      data: {
        id: replyId,
        organizationId,
        conversationId: conversation.id,
        prospectId: contact.prospectId,
        contactId: contact.id,
        fromEmail: email,
        subject,
        body: payload.snippet || "(No preview was returned by Gmail.)",
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    reply = { id: replyId };
  }
  await prisma.prospect.update({ where: { id: contact.prospectId }, data: { outreachState: "REPLIED" } });
  await prisma.outreachMessage.updateMany({
    where: { prospectId: contact.prospectId, state: { in: ["SENT", "DELIVERED", "OPENED"] } },
    data: { state: "REPLIED" },
  });
  await prisma.followUp.updateMany({
    where: { prospectId: contact.prospectId, state: { in: ["SCHEDULED", "PENDING_APPROVAL"] } },
    data: { state: "CANCELLED" },
  });
  await queueJob({
    id: classifyJobId(reply.id),
    organizationId,
    prospectId: contact.prospectId,
    queue: "reply-analysis",
    name: "reply.classify",
    payload: { replyId: reply.id },
  });
}

// Delivery failure notices come from the mail system, not from a prospect. They never become
// replies. The notice is read in full, tied to one recipient, and recorded once per Gmail message.
async function importGmailBounce(organizationId: string, accessToken: string, messageId: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return;
  const message = (await response.json()) as GmailPart & { payload?: GmailPart; threadId?: string };
  const root = message.payload;
  const headers: Record<string, string> = {};
  for (const header of root?.headers ?? []) headers[header.name.toLowerCase()] = header.value;
  const bounce = noticeAuthenticationFailed(headers) ? null : parseGmailBounce({ headers, body: gmailDeliveryStatusText(root) });
  const notice = { threadId: message.threadId, originalMessageIds: originalMessageIds(root) };
  const verifyOrigin = async (providerIds: string[]) => {
    if (!notice.threadId || notice.originalMessageIds.length === 0) return false;
    for (const id of providerIds) {
      const sentResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Message-ID`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!sentResponse.ok) continue;
      const sentMessage = (await sentResponse.json()) as { threadId?: string; payload?: { headers?: Array<{ name: string; value: string }> } };
      const messageId = sentMessage.payload?.headers?.find((header) => header.name.toLowerCase() === "message-id")?.value;
      if (sentMessageMatchesNotice({ threadId: sentMessage.threadId, messageId }, notice)) return true;
    }
    return false;
  };
  await applyGmailBounce(prisma, { organizationId, gmailMessageId: messageId, bounce, verifyOrigin });
}

async function gmailAccessToken(refreshToken: string) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new AppError("Gmail OAuth is not configured.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new AppError("Gmail refused to refresh the connection.");
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new AppError("Gmail did not return an access token.");
  return payload.access_token;
}

import { classifyAndDraftEmployerReply } from "@/lib/applications/email-ai";

export async function processEmployerReply(replyId: string) {
  const reply = await prisma.employerReply.findUnique({
    where: { id: replyId },
    include: { 
      application: { 
        include: { 
          vacancy: true, 
          candidate: { include: { facts: true } } 
        } 
      } 
    }
  });
  if (!reply) return;
  
  const candidateFacts = reply.application.candidate.facts.map(f => f.fact);

  const { classification, suggestedDraft } = await classifyAndDraftEmployerReply(
    reply.subject || "",
    reply.body,
    reply.application.vacancy.companyName,
    reply.application.vacancy.title,
    `${reply.application.candidate.firstName} ${reply.application.candidate.lastName}`,
    candidateFacts
  );

  await prisma.employerReply.update({
    where: { id: replyId },
    data: {
      classification,
      suggestedDraft,
      draftStatus: "PENDING"
    }
  });
}
