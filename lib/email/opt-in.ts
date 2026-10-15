import type { Prisma } from "@prisma/client";

// A contact whose source is "opt-in" may only receive unattended mail while a CONFIRMED subscriber
// record points at it. The source label alone is not consent: an unsubscribe, a re-subscription that
// is still pending, or a manually edited label must each stop the message.
export function isOptInSource(source: string | null | undefined) {
  return (source ?? "").trim().toLowerCase() === "opt-in";
}

type SubscriberDb = { subscriber: Pick<Prisma.SubscriberDelegate, "findFirst" | "findMany"> };

export async function hasConfirmedSubscription(db: SubscriberDb, organizationId: string, contactId: string) {
  const row = await db.subscriber.findFirst({
    where: { organizationId, contactId, status: "CONFIRMED" },
    select: { id: true },
  });
  return row !== null;
}

export async function confirmedOptInContactIds(db: SubscriberDb): Promise<string[]> {
  const rows = await db.subscriber.findMany({
    where: { status: "CONFIRMED", contactId: { not: null } },
    select: { contactId: true },
  });
  return rows.flatMap((row) => (row.contactId ? [row.contactId] : []));
}
