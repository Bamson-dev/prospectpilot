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

type BounceDb = {
  outreachMessage: Pick<Prisma.OutreachMessageDelegate, "findMany">;
  suppression: Pick<Prisma.SuppressionDelegate, "upsert">;
  contact: Pick<Prisma.ContactDelegate, "updateMany">;
  followUp: Pick<Prisma.FollowUpDelegate, "updateMany">;
  activityLog: Pick<Prisma.ActivityLogDelegate, "findFirst" | "create">;
};

export type BounceOutcome = "suppressed" | "already-recorded" | "temporary-logged" | "unresolved";

// Applies one parsed bounce inside one organization. The address is suppressed only when this
// organization sent at least one message to it. Replaying the same Gmail message changes nothing.
// verifyOrigin receives the provider ids of this organization's messages to the failed address and
// returns true only when the notice sits in the same Gmail thread as one of them. A forged notice
// from a spoofed sender cannot join the thread of a message it never saw, so it suppresses nobody.
export async function applyGmailBounce(
  db: BounceDb,
  input: { organizationId: string; gmailMessageId: string; bounce: GmailBounce | null; verifyOrigin: (providerMessageIds: string[]) => Promise<boolean> },
): Promise<BounceOutcome> {
  const marker = `gmail-dsn:${input.gmailMessageId}`;
  const seen = await db.activityLog.findFirst({ where: { organizationId: input.organizationId, detail: { contains: marker } }, select: { id: true } });
  if (seen) return "already-recorded";
  const log = (action: string, detail: string) =>
    db.activityLog.create({ data: { organizationId: input.organizationId, action, detail: `${detail} ${marker}`.slice(0, 500) } });

  if (!input.bounce) {
    await log("outreach.bounce_unresolved", "Delivery failure notice could not be tied to one recipient.");
    return "unresolved";
  }
  const email = input.bounce.recipient.trim().toLowerCase();
  const sent = await db.outreachMessage.findMany({
    where: {
      organizationId: input.organizationId,
      state: { in: ["SENT", "DELIVERED", "OPENED", "REPLIED", "SENDING"] },
      contact: { email: { equals: email, mode: "insensitive" } },
    },
    select: { prospectId: true, providerMessageId: true },
  });
  if (sent.length === 0) {
    await log("outreach.bounce_unresolved", `Bounce for an address this organization has not contacted (${input.bounce.status}).`);
    return "unresolved";
  }
  const providerIds = sent.map((item) => item.providerMessageId).filter((id): id is string => Boolean(id));
  if (providerIds.length === 0 || !(await input.verifyOrigin(providerIds))) {
    await log("outreach.bounce_unresolved", `Failure notice for ${email} is not in the thread of a message this organization sent. No suppression.`);
    return "unresolved";
  }
  if (input.bounce.kind !== "permanent") {
    await log("outreach.bounce_temporary", `Temporary delivery problem ${input.bounce.status} for ${email}. No suppression.`);
    return "temporary-logged";
  }
  await db.suppression.upsert({
    where: { organizationId_email: { organizationId: input.organizationId, email } },
    update: {},
    create: { organizationId: input.organizationId, email, reason: "hard_bounce", source: "gmail_dsn" },
  });
  await db.contact.updateMany({ where: { organizationId: input.organizationId, email: { equals: email, mode: "insensitive" } }, data: { suppressed: true } });
  for (const prospectId of new Set(sent.map((item) => item.prospectId))) {
    await db.followUp.updateMany({ where: { organizationId: input.organizationId, prospectId, state: { in: ["SCHEDULED", "PENDING_APPROVAL"] } }, data: { state: "CANCELLED" } });
  }
  await log("outreach.bounce_suppressed", `Permanent bounce ${input.bounce.status} for ${email}.`);
  return "suppressed";
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
