import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { classifyJobId } from "@/lib/email/message-policy";
import { AppError } from "@/lib/errors";
import { queueJob } from "@/lib/jobs";

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
    if (!list.ok) throw new AppError(`Gmail inbox sync failed with status ${list.status}.`);
    const payload = (await list.json()) as { messages?: Array<{ id: string }> };
    for (const item of payload.messages ?? []) {
      await importGmailMessage(organizationId, accessToken, item.id);
    }
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
  const contact = await prisma.contact.findFirst({
    where: { organizationId, email },
    include: { prospect: true },
  });
  if (!contact) return;
  const replyId = `gmail:${messageId}`;
  const stored = await prisma.reply.findUnique({ where: { id: replyId }, select: { id: true } });
  if (stored) return;
  const existing = await prisma.reply.findFirst({
    where: { prospectId: contact.prospectId, fromEmail: email, subject },
  });
  if (existing) return;
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
