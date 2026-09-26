import { prisma } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const contactId = token ? await verifyUnsubscribeToken(token) : null;
  if (!contactId) {
    return <main className="mx-auto max-w-lg px-6 py-16"><h1 className="font-display text-4xl">This unsubscribe link is not valid.</h1></main>;
  }
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact?.email) {
    return <main className="mx-auto max-w-lg px-6 py-16"><h1 className="font-display text-4xl">No contact was found for this link.</h1></main>;
  }
  await prisma.suppression.upsert({
    where: { organizationId_email: { organizationId: contact.organizationId, email: contact.email.toLowerCase() } },
    update: { reason: "Unsubscribe link", source: "unsubscribe-link" },
    create: { organizationId: contact.organizationId, email: contact.email.toLowerCase(), reason: "Unsubscribe link", source: "unsubscribe-link" },
  });
  await prisma.contact.update({ where: { id: contact.id }, data: { suppressed: true } });
  await prisma.followUp.updateMany({ where: { prospectId: contact.prospectId, state: { in: ["SCHEDULED", "PENDING_APPROVAL"] } }, data: { state: "CANCELLED" } });
  return <main className="mx-auto max-w-lg px-6 py-16"><h1 className="font-display text-4xl">You will not receive further campaign email at {contact.email}.</h1></main>;
}
