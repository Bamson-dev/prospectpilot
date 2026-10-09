import type { Prisma } from "@prisma/client";
import { providerEventSuppresses } from "@/lib/email/message-policy";

type EventDb = {
  outreachMessage: Pick<Prisma.OutreachMessageDelegate, "findMany">;
  suppression: Pick<Prisma.SuppressionDelegate, "upsert">;
  contact: Pick<Prisma.ContactDelegate, "updateMany">;
};

// Adds the recipient of a bounced or complained message to the suppression list.
// Replaying the same event is safe: the upsert keeps an existing entry unchanged.
export async function suppressRecipientForProviderEvent(db: EventDb, eventType: string, providerMessageId: string) {
  if (!providerMessageId || !providerEventSuppresses(eventType)) return 0;
  const sent = await db.outreachMessage.findMany({
    where: { providerMessageId },
    select: { organizationId: true, contact: { select: { email: true } } },
  });
  let suppressed = 0;
  for (const item of sent) {
    const email = item.contact?.email?.trim().toLowerCase();
    if (!email) continue;
    await db.suppression.upsert({
      where: { organizationId_email: { organizationId: item.organizationId, email } },
      update: {},
      create: { organizationId: item.organizationId, email, reason: eventType === "email.bounced" ? "hard_bounce" : "spam_complaint", source: "resend_webhook" },
    });
    await db.contact.updateMany({ where: { organizationId: item.organizationId, email: { equals: email, mode: "insensitive" } }, data: { suppressed: true } });
    suppressed += 1;
  }
  return suppressed;
}
