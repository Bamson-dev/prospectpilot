import type { Prisma } from "@prisma/client";

export type GmailBounce = {
  recipient: string;
  status: string;
  // "permanent" bounces suppress the address. Everything else is only logged.
  kind: "permanent" | "temporary";
};

// Only Google's own delivery notices count. A notice from any other domain is read as ordinary mail,
// so a forged mailer-daemon@ address on another domain can never reach the suppression path.
const MAILER_SENDERS = /^mailer-daemon@(googlemail|gmail)\.com$/i;

export function isBounceSender(from: string) {
  const address = from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  return MAILER_SENDERS.test(address);
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// Reads a delivery status notification. It returns a result only when the notice names exactly one
// failed recipient and carries an RFC 3463 status code. Anything else returns null so the caller
// logs it for review and suppresses nobody.
export function parseGmailBounce(input: { headers: Record<string, string>; body: string }): GmailBounce | null {
  const body = input.body;
  const failedHeader = input.headers["x-failed-recipients"]?.trim();
  const finalRecipients = [...body.matchAll(/^Final-Recipient:\s*rfc822;\s*(\S+)/gim)].map((m) => m[1].toLowerCase());
  const statusMatch = body.match(/^Status:\s*([245]\.\d{1,3}\.\d{1,3})/im);
  const actions = [...body.matchAll(/^Action:\s*(\w+)/gim)].map((m) => m[1].toLowerCase());

  const candidates = new Set<string>();
  if (failedHeader) for (const part of failedHeader.split(",")) { const m = part.match(EMAIL); if (m) candidates.add(m[0].toLowerCase()); }
  for (const item of finalRecipients) { const m = item.match(EMAIL); if (m) candidates.add(m[0].toLowerCase()); }
  if (candidates.size !== 1) return null;
  const recipient = [...candidates][0];

  // Gmail also writes "Status: 5.1.1" in the human-readable text for some notices, so the code is
  // taken from the machine-readable delivery-status part first.
  const status = statusMatch?.[1];
  if (!status) return null;
  // The machine-readable delivery-status part must say what happened. Text alone is not enough.
  if (actions.length !== 1 || (actions[0] !== "failed" && actions[0] !== "delayed")) return null;
  const permanent = status.startsWith("5") && actions[0] === "failed";
  return { recipient, status, kind: permanent ? "permanent" : "temporary" };
}

type BounceTx = {
  outreachMessage: Pick<Prisma.OutreachMessageDelegate, "findMany">;
  suppression: Pick<Prisma.SuppressionDelegate, "upsert">;
  contact: Pick<Prisma.ContactDelegate, "updateMany">;
  followUp: Pick<Prisma.FollowUpDelegate, "updateMany">;
  activityLog: Pick<Prisma.ActivityLogDelegate, "findFirst" | "create">;
  $executeRaw: Prisma.TransactionClient["$executeRaw"];
};
type BounceDb = BounceTx & { $transaction<T>(fn: (tx: BounceTx) => Promise<T>): Promise<T> };

export type BounceOutcome = "suppressed" | "already-recorded" | "temporary-logged" | "unresolved";

// Applies one parsed bounce inside one organization. The address is suppressed only when this
// organization sent at least one message to it and verifyOrigin confirms the notice belongs to one
// of those sent messages. Replaying the same Gmail message changes nothing: the write phase takes an
// advisory lock on the notice marker and re-checks it, so two concurrent syncs cannot both record it.
export async function applyGmailBounce(
  db: BounceDb,
  input: { organizationId: string; gmailMessageId: string; bounce: GmailBounce | null; verifyOrigin: (providerMessageIds: string[]) => Promise<boolean> },
): Promise<BounceOutcome> {
  const marker = `gmail-dsn:${input.gmailMessageId}`;
  const isSeen = (client: Pick<BounceTx, "activityLog">) =>
    client.activityLog.findFirst({ where: { organizationId: input.organizationId, detail: { contains: marker } }, select: { id: true } });
  if (await isSeen(db)) return "already-recorded";

  // Decide first, with reads and the provider check only. No transaction stays open during the network call.
  type Plan = { outcome: BounceOutcome; action: string; detail: string; suppress?: { email: string; prospectIds: string[] } };
  const plan = await (async (): Promise<Plan> => {
    if (!input.bounce) return { outcome: "unresolved", action: "outreach.bounce_unresolved", detail: "Delivery failure notice could not be tied to one recipient." };
    const email = input.bounce.recipient.trim().toLowerCase();
    const sent = await db.outreachMessage.findMany({
      where: {
        organizationId: input.organizationId,
        state: { in: ["SENT", "DELIVERED", "OPENED", "REPLIED", "SENDING"] },
        contact: { email: { equals: email, mode: "insensitive" } },
      },
      select: { prospectId: true, providerMessageId: true },
    });
    if (sent.length === 0) return { outcome: "unresolved", action: "outreach.bounce_unresolved", detail: `Bounce for an address this organization has not contacted (${input.bounce.status}).` };
    const providerIds = sent.map((item) => item.providerMessageId).filter((id): id is string => Boolean(id));
    if (providerIds.length === 0 || !(await input.verifyOrigin(providerIds))) {
      return { outcome: "unresolved", action: "outreach.bounce_unresolved", detail: `Failure notice for ${email} could not be tied to a message this organization sent. No suppression.` };
    }
    if (input.bounce.kind !== "permanent") {
      return { outcome: "temporary-logged", action: "outreach.bounce_temporary", detail: `Temporary delivery problem ${input.bounce.status} for ${email}. No suppression.` };
    }
    return { outcome: "suppressed", action: "outreach.bounce_suppressed", detail: `Permanent bounce ${input.bounce.status} for ${email}.`, suppress: { email, prospectIds: [...new Set(sent.map((item) => item.prospectId))] } };
  })();

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:${marker}`}, 0))`;
    if (await isSeen(tx)) return "already-recorded" as const;
    if (plan.suppress) {
      const { email, prospectIds } = plan.suppress;
      await tx.suppression.upsert({
        where: { organizationId_email: { organizationId: input.organizationId, email } },
        update: {},
        create: { organizationId: input.organizationId, email, reason: "hard_bounce", source: "gmail_dsn" },
      });
      await tx.contact.updateMany({ where: { organizationId: input.organizationId, email: { equals: email, mode: "insensitive" } }, data: { suppressed: true } });
      for (const prospectId of prospectIds) {
        await tx.followUp.updateMany({ where: { organizationId: input.organizationId, prospectId, state: { in: ["SCHEDULED", "PENDING_APPROVAL"] } }, data: { state: "CANCELLED" } });
      }
    }
    await tx.activityLog.create({ data: { organizationId: input.organizationId, action: plan.action, detail: `${plan.detail} ${marker}`.slice(0, 500) } });
    return plan.outcome;
  });
}

// True when a sent message is the original of a failure notice. Both must hold: the notice sits in
// the same Gmail thread, and the original Message-ID quoted inside the notice equals the RFC
// Message-ID of the message we sent. A notice that quotes no original id never matches.
export function sentMessageMatchesNotice(
  sent: { threadId?: string; messageId?: string },
  notice: { threadId?: string; originalMessageIds: string[] },
) {
  if (!sent.threadId || !notice.threadId || sent.threadId !== notice.threadId) return false;
  const wanted = normalizeMessageId(sent.messageId);
  return Boolean(wanted) && notice.originalMessageIds.map(normalizeMessageId).includes(wanted);
}

export function normalizeMessageId(value: string | undefined) {
  return (value ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
}

// Reads only the machine-readable message/delivery-status part. Plain-text parts are ignored, so a
// forged body that merely mentions Final-Recipient or Status lines cannot produce a bounce.
export function gmailDeliveryStatusText(part: GmailPart | undefined, insideStatus = false): string {
  if (!part) return "";
  const status = insideStatus || part.mimeType === "message/delivery-status";
  const own = status && part.body?.data ? Buffer.from(part.body.data, "base64url").toString("utf8") : "";
  const fields = status ? (part.headers ?? []).map((header) => `${header.name}: ${header.value}`).join("\n") : "";
  return [own, fields, ...(part.parts ?? []).map((child) => gmailDeliveryStatusText(child, status))].filter(Boolean).join("\n");
}

// Collects the Message-ID values of the original message quoted inside a delivery notice.
const ORIGINAL_TYPES = new Set(["message/rfc822", "text/rfc822-headers", "message/rfc822-headers"]);
export function originalMessageIds(part: GmailPart | undefined, insideOriginal = false): string[] {
  if (!part) return [];
  const original = insideOriginal || ORIGINAL_TYPES.has(part.mimeType ?? "");
  const ids: string[] = [];
  if (original) {
    for (const header of part.headers ?? []) if (header.name.toLowerCase() === "message-id") ids.push(header.value);
    if (part.body?.data && (part.mimeType?.startsWith("text/") || part.mimeType?.startsWith("message/"))) {
      const text = Buffer.from(part.body.data, "base64url").toString("utf8");
      for (const match of text.matchAll(/^Message-ID:\s*(<[^>\r\n]+>)/gim)) ids.push(match[1]);
    }
  }
  for (const child of part.parts ?? []) ids.push(...originalMessageIds(child, original));
  return [...new Set(ids.map(normalizeMessageId).filter(Boolean))];
}

// Authentication-Results is optional on notices Google generates itself. A recorded failure of
// DKIM, SPF or DMARC means the notice is not trusted. A missing header does not block, because the
// original Message-ID and thread checks still apply.
export function noticeAuthenticationFailed(headers: Record<string, string>) {
  const value = headers["authentication-results"] ?? "";
  return /\b(dkim|spf|dmarc)=(fail|softfail|permerror|temperror)\b/i.test(value);
}

// Flattens a Gmail API "full" message payload into its plain-text content.
export type GmailPart = { mimeType?: string; headers?: Array<{ name: string; value: string }>; body?: { data?: string }; parts?: GmailPart[] };
export function gmailPlainText(part: GmailPart | undefined, insideStatus = false): string {
  if (!part) return "";
  const status = insideStatus || part.mimeType === "message/delivery-status";
  const own = part.body?.data && (part.mimeType?.startsWith("text/") || status)
    ? Buffer.from(part.body.data, "base64url").toString("utf8")
    : "";
  // The Gmail API returns delivery-status fields as part headers, not as body text.
  const fields = status ? (part.headers ?? []).map((header) => `${header.name}: ${header.value}`).join("\n") : "";
  return [own, fields, ...(part.parts ?? []).map((child) => gmailPlainText(child, status))].filter(Boolean).join("\n");
}
