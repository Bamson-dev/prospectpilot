import type { Prisma } from "@prisma/client";
import { alreadyContactedRecipient } from "@/lib/email/message-policy";

export type SendReservation = "claimed" | "duplicate-recipient" | "not-claimable";

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

// Serializes sends to one address inside one organization. The advisory lock is released when the
// transaction ends, and the SENDING claim is committed before the caller contacts the provider,
// so no transaction stays open during the network request.
export async function reserveRecipientSend(
  db: ReservationDb,
  input: { messageId: string; organizationId: string; email: string },
): Promise<SendReservation> {
  const email = normalizeRecipient(input.email);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${recipientLockKey(input.organizationId, email)}, 0))`;
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
    const claim = await tx.outreachMessage.updateMany({
      where: { id: input.messageId, state: { in: [...CLAIMABLE_STATES] } },
      data: { state: "SENDING", error: null },
    });
    return claim.count === 1 ? ("claimed" as const) : ("not-claimable" as const);
  });
}
