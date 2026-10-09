import { prisma } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/session";
import { suppressContactForUnsubscribe } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const contactId = token ? await verifyUnsubscribeToken(token) : null;
  if (!contactId) {
    return <main className="mx-auto max-w-lg px-6 py-16"><h1 className="font-display text-4xl">This unsubscribe link is not valid.</h1></main>;
  }
  const email = await suppressContactForUnsubscribe(prisma, contactId);
  if (!email) {
    return <main className="mx-auto max-w-lg px-6 py-16"><h1 className="font-display text-4xl">No contact was found for this link.</h1></main>;
  }
  return <main className="mx-auto max-w-lg px-6 py-16"><h1 className="font-display text-4xl">You will not receive further campaign email at {email}.</h1></main>;
}
