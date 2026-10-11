import type { Prisma } from "@prisma/client";

type UnsubscribeDb = {
  contact: Pick<Prisma.ContactDelegate, "findUnique" | "findMany" | "updateMany">;
  suppression: Pick<Prisma.SuppressionDelegate, "upsert">;
  followUp: Pick<Prisma.FollowUpDelegate, "updateMany">;
  subscriber?: Pick<Prisma.SubscriberDelegate, "updateMany">;
};

// Adds the contact's address to the suppression list, marks every contact with that address as
// suppressed, and cancels scheduled follow-ups. Safe to call repeatedly. An earlier suppression
// reason stays in place when the address was already suppressed.
export async function suppressContactForUnsubscribe(db: UnsubscribeDb, contactId: string) {
  const contact = await db.contact.findUnique({ where: { id: contactId } });
  if (!contact?.email) return null;
  const email = contact.email.trim().toLowerCase();
  await db.suppression.upsert({
    where: { organizationId_email: { organizationId: contact.organizationId, email } },
    update: {},
    create: { organizationId: contact.organizationId, email, reason: "Unsubscribe link", source: "unsubscribe-link" },
  });
  await db.contact.updateMany({ where: { organizationId: contact.organizationId, email: { equals: email, mode: "insensitive" } }, data: { suppressed: true } });
  const sameAddress = await db.contact.findMany({
    where: { organizationId: contact.organizationId, email: { equals: email, mode: "insensitive" } },
    select: { prospectId: true },
  });
  const prospectIds = [...new Set([contact.prospectId, ...sameAddress.map((item) => item.prospectId)])];
  await db.followUp.updateMany({
    where: { organizationId: contact.organizationId, prospectId: { in: prospectIds }, state: { in: ["SCHEDULED", "PENDING_APPROVAL"] } },
    data: { state: "CANCELLED" },
  });
  await db.subscriber?.updateMany({
    where: { organizationId: contact.organizationId, email, status: { not: "UNSUBSCRIBED" } },
    data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date(), confirmTokenHash: null },
  });
  return email;
}
