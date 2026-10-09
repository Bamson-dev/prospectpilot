import type { Prisma } from "@prisma/client";
import { alreadyContactedRecipient } from "@/lib/email/message-policy";

export type SendReservation = "claimed" | "duplicate-recipient" | "domain-limit" | "not-claimable";

type ReservationDb = {
  $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
};

const CLAIMABLE_STATES = ["APPROVED", "QUEUED", "FAILED"] as const;
const CONTACTED_STATES = ["SENDING", "SENT", "DELIVERED", "OPENED", "REPLIED"] as const;

export function normalizeRecipient(email: string) {
  return email.trim().toLowerCase();
}

export function recipientLockKey(organizationId: string, email: string) {
  return `outreach-recipient:${organizationId}:${normalizeRecipient(email)}`;
}

export function recipientDomain(email: string) {
  return normalizeRecipient(email).split("@").pop() ?? "";
}

export function domainLockKey(organizationId: string, domain: string) {
  return `outreach-domain:${organizationId}:${domain.trim().toLowerCase()}`;
}

export function defaultDomainDailyLimit(value = process.env.OUTREACH_DOMAIN_DAILY_LIMIT) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 2;
}

// Takes a transaction-scoped PostgreSQL advisory lock for one recipient. The statement is a SELECT
// that returns void, so it runs through $executeRaw (the same pattern qualification.ts uses in
// production). The lock is parameterized and is released automatically when the transaction ends.
export async function acquireRecipientLock(tx: Pick<Prisma.TransactionClient, "$executeRaw">, organizationId: string, email: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${recipientLockKey(organizationId, email)}, 0))`;
}

// Serializes sends to one address inside one organization. The advisory lock is released when the
// transaction ends, and the SENDING claim is committed before the caller contacts the provider,
// so no transaction stays open during the network request.
export async function reserveRecipientSend(
  db: ReservationDb,
  input: { messageId: string; organizationId: string; email: string; domainDailyLimit?: number; now?: Date },
): Promise<SendReservation> {
  const email = normalizeRecipient(input.email);
  return db.$transaction(async (tx) => {
    await acquireRecipientLock(tx, input.organizationId, email);
    const others = await tx.outreachMessage.findMany({
      where: {
        organizationId: input.organizationId,
        id: { not: input.messageId },
        state: { in: [...CONTACTED_STATES] },
        contact: { email: { equals: email, mode: "insensitive" } },
      },
      select: { state: true },
    });
    if (alreadyContactedRecipient(others.map((item) => item.state))) {
      await tx.outreachMessage.updateMany({
        where: { id: input.messageId, state: { in: [...CLAIMABLE_STATES] } },
        data: { state: "CANCELLED", error: "This address was already contacted by another message." },
      });
      return "duplicate-recipient" as const;
    }
    if (input.domainDailyLimit !== undefined) {
      // The domain lock is taken after the recipient lock in every transaction, so two sends to
      // different addresses at one domain queue behind each other without a lock-order cycle.
      const domain = recipientDomain(email);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${domainLockKey(input.organizationId, domain)}, 0))`;
      const dayStart = new Date(input.now ?? new Date());
      dayStart.setUTCHours(0, 0, 0, 0);
      const usedToday = await tx.outreachMessage.count({
        where: {
          organizationId: input.organizationId,
          id: { not: input.messageId },
          contact: { email: { endsWith: `@${domain}`, mode: "insensitive" } },
          // A message in SENDING may have been delivered, so it counts until someone reconciles it.
          OR: [{ state: "SENDING" }, { sentAt: { gte: dayStart } }],
        },
      });
      if (usedToday >= input.domainDailyLimit) return "domain-limit" as const;
    }
    const claim = await tx.outreachMessage.updateMany({
      where: { id: input.messageId, state: { in: [...CLAIMABLE_STATES] } },
      data: { state: "SENDING", error: null },
    });
    return claim.count === 1 ? ("claimed" as const) : ("not-claimable" as const);
  });
}
