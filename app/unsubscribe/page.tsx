import { prisma } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/session";
import { suppressContactForUnsubscribe } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

// Opening this page changes nothing, so mail scanners and link previews cannot unsubscribe anyone.
// The suppression happens only when the recipient submits the form (POST via a server action).
async function confirmUnsubscribe(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const contactId = token ? await verifyUnsubscribeToken(token) : null;
  if (contactId) await suppressContactForUnsubscribe(prisma, contactId);
}

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string; done?: string }> }) {
  const { token } = await searchParams;
  const contactId = token ? await verifyUnsubscribeToken(token) : null;
  if (!token || !contactId) {
    return <main className="mx-auto max-w-lg px-6 py-16"><h1 className="font-display text-4xl">This unsubscribe link is not valid.</h1></main>;
  }
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { email: true, suppressed: true } });
  if (!contact?.email) {
    return <main className="mx-auto max-w-lg px-6 py-16"><h1 className="font-display text-4xl">No contact was found for this link.</h1></main>;
  }
  if (contact.suppressed) {
    return <main className="mx-auto max-w-lg px-6 py-16"><h1 className="font-display text-4xl">You will not receive further campaign email at {contact.email}.</h1></main>;
  }
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="font-display text-4xl">Unsubscribe {contact.email}?</h1>
      <p className="mt-4">Confirm to stop all further email from us to this address.</p>
      <form action={confirmUnsubscribe} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="rounded border px-4 py-2">Unsubscribe</button>
      </form>
    </main>
  );
}
