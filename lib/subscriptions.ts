import { createHash, randomBytes } from "node:crypto";

// The exact wording shown next to the unticked checkbox. Change CONSENT_VERSION whenever the text changes,
// so every stored consent points at the words the person actually agreed to.
export const CONSENT_VERSION = "2026-10-10.1";
export function consentText(senderName: string) {
  return `Yes, I want to receive occasional emails from ${senderName} about digital marketing, lead generation and software services. I can unsubscribe at any time using the link in every email.`;
}

export type SubscribeInput = { email: string; name?: string; company?: string; consent: boolean };

export function validateSubscription(input: SubscribeInput): { ok: true; email: string; name: string | null; company: string | null } | { ok: false; error: string } {
  if (!input.consent) return { ok: false, error: "Tick the box to confirm that you want these emails." };
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return { ok: false, error: "Enter a valid email address." };
  const clean = (v?: string) => (v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 120) || null;
  return { ok: true, email, name: clean(input.name), company: clean(input.company) };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

type SubscriberRow = { id: string; organizationId: string; email: string; name: string | null; company: string | null; status: "PENDING" | "CONFIRMED" | "UNSUBSCRIBED"; contactId: string | null };

type Db = {
  subscriber: {
    findUnique(args: { where: { organizationId_email: { organizationId: string; email: string } } }): Promise<SubscriberRow | null>;
    findFirst(args: { where: { confirmTokenHash: string; status: "PENDING" } }): Promise<(SubscriberRow & { createdAt: Date }) | null>;
    upsert(args: unknown): Promise<SubscriberRow>;
    update(args: unknown): Promise<SubscriberRow>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  suppression: { findUnique(args: { where: { organizationId_email: { organizationId: string; email: string } } }): Promise<unknown | null> };
  prospect: { create(args: unknown): Promise<{ id: string }> };
  contact: { create(args: unknown): Promise<{ id: string }> };
  $transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
};

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Records a pending subscription with the consent wording shown. Returns a one-time confirmation token,
// or null when the address is suppressed (an earlier objection is respected; no email is sent).
export async function createPendingSubscription(db: Db, input: { organizationId: string; email: string; name: string | null; company: string | null; consentText: string; source: string }) {
  const suppressed = await db.suppression.findUnique({ where: { organizationId_email: { organizationId: input.organizationId, email: input.email } } });
  if (suppressed) return null;
  const existing = await db.subscriber.findUnique({ where: { organizationId_email: { organizationId: input.organizationId, email: input.email } } });
  if (existing?.status === "CONFIRMED") return null;
  const token = randomBytes(32).toString("base64url");
  await db.subscriber.upsert({
    where: { organizationId_email: { organizationId: input.organizationId, email: input.email } },
    create: { organizationId: input.organizationId, email: input.email, name: input.name, company: input.company, consentText: input.consentText, consentVersion: CONSENT_VERSION, source: input.source, confirmTokenHash: hashToken(token) },
    update: { name: input.name, company: input.company, status: "PENDING", consentText: input.consentText, consentVersion: CONSENT_VERSION, source: input.source, confirmTokenHash: hashToken(token), confirmedAt: null, unsubscribedAt: null },
  });
  return token;
}

// Confirms the subscription and creates the opt-in contact that the sender accepts. The token works once.
export async function confirmSubscription(db: Db, token: string, now = new Date()) {
  if (!token || token.length < 20) return null;
  return db.$transaction(async (tx) => {
    const sub = await tx.subscriber.findFirst({ where: { confirmTokenHash: hashToken(token), status: "PENDING" } });
    if (!sub || now.getTime() - sub.createdAt.getTime() > TOKEN_TTL_MS) return null;
    const suppressed = await tx.suppression.findUnique({ where: { organizationId_email: { organizationId: sub.organizationId, email: sub.email } } });
    if (suppressed) return null;
    let contactId = sub.contactId;
    if (!contactId) {
      const prospect = await tx.prospect.create({
        data: { organizationId: sub.organizationId, companyName: sub.company ?? sub.name ?? sub.email, source: "opt-in-form", sourceUrl: `subscriber:${sub.id}` },
      });
      const contact = await tx.contact.create({
        data: { organizationId: sub.organizationId, prospectId: prospect.id, email: sub.email, fullName: sub.name, source: "opt-in", sourceUrl: `subscriber:${sub.id}`, confidence: 100, isPrimary: true },
      });
      contactId = contact.id;
    }
    return tx.subscriber.update({ where: { id: sub.id }, data: { status: "CONFIRMED", confirmedAt: now, confirmTokenHash: null, contactId } });
  });
}

export function confirmationEmail(input: { senderName: string; confirmUrl: string; consentText: string }) {
  const text = [
    `Please confirm that you want to receive emails from ${input.senderName}.`,
    "",
    `You agreed to: "${input.consentText}"`,
    "",
    `Confirm here: ${input.confirmUrl}`,
    "",
    "If you did not ask for this, ignore this email. You will not be added.",
  ].join("\n");
  return { subject: `Confirm your subscription to ${input.senderName}`, text };
}
