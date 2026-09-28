import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logInfo } from "@/lib/logger";
import { queueJob } from "@/lib/jobs";
import { onlyMatchingContact, providerEventWrite, webhookTimestampFresh } from "@/lib/email/message-policy";
import { isSuppressionRequest } from "@/lib/suppression";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const body = await request.text();
  if (!secret) return NextResponse.json({ ok: false, error: "Webhook secret is not configured." }, { status: 401 });
  const id = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signature = request.headers.get("svix-signature") ?? "";
  if (!webhookTimestampFresh(timestamp, Date.now()) || !validSignature(secret, id, timestamp, body, signature)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  let event: { type?: string; data?: { email_id?: string; from?: string; subject?: string; text?: string } };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const emailId = event.data?.email_id;
  const write = event.type ? providerEventWrite(event.type) : null;
  if (write && emailId) {
    await prisma.outreachMessage.updateMany({
      where: { providerMessageId: emailId, state: { in: write.from } },
      data: {
        state: write.state,
        error: write.error,
        ...(write.state === "DELIVERED" ? { deliveredAt: new Date() } : {}),
        ...(write.state === "OPENED" ? { openedAt: new Date() } : {}),
      },
    });
  }
  if ((event.type === "email.received" || event.type === "email.replied") && event.data?.from) {
    const from = event.data.from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
    if (from) {
      const contacts = await prisma.contact.findMany({ where: { email: from }, take: 2 });
      const contact = onlyMatchingContact(contacts);
      if (contact) {
        const conversation = await prisma.conversation.findFirst({ where: { prospectId: contact.prospectId }, orderBy: { updatedAt: "desc" } });
        if (conversation) {
          const reply = await prisma.reply.create({
            data: {
              organizationId: contact.organizationId,
              conversationId: conversation.id,
              prospectId: contact.prospectId,
              contactId: contact.id,
              fromEmail: from,
              subject: event.data.subject,
              body: event.data.text || "(No message body was included.)",
              classification: event.data.text && isSuppressionRequest(event.data.text) ? "UNSUBSCRIBE" : "UNCLASSIFIED",
            },
          });
          await queueJob({
            organizationId: contact.organizationId,
            prospectId: contact.prospectId,
            queue: "reply-analysis",
            name: "reply.classify",
            payload: { replyId: reply.id },
          });
        }
      } else if (contacts.length > 1) {
        logInfo("resend.webhook.ambiguous_sender", { matches: contacts.length });
      }
    }
  }
  logInfo("resend.webhook", { type: event.type ?? "unknown" });
  return NextResponse.json({ ok: true });
}

function validSignature(secret: string, id: string, timestamp: string, body: string, header: string) {
  if (!id || !timestamp || !header) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return header.split(" ").some((part) => {
    const signature = part.split(",")[1];
    if (!signature) return false;
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  });
}
