import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRedis } from "@/lib/queues";
import { senderIdentityFromEnv } from "@/lib/compliance/uk-b2b";
import { confirmationEmail, consentText, createPendingSubscription, validateSubscription } from "@/lib/subscriptions";
import { sendSubscriptionConfirmation } from "@/lib/subscription-mail";

export const dynamic = "force-dynamic";

async function subscribe(formData: FormData) {
  "use server";
  const slug = String(formData.get("slug") ?? "");
  const back = (status: string) => redirect(`/subscribe/${encodeURIComponent(slug)}?status=${status}`);
  const sender = senderIdentityFromEnv();
  const organization = await prisma.organization.findUnique({ where: { slug } });
  if (!sender || !organization) return back("closed");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = `subscribe:rate:${ip}`;
  const count = await getRedis().incr(key);
  if (count === 1) await getRedis().expire(key, 3600);
  if (count > 5) return back("limited");
  const valid = validateSubscription({
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
    company: String(formData.get("company") ?? ""),
    consent: formData.get("consent") === "yes",
  });
  if (!valid.ok) return back("invalid");
  const wording = consentText(sender.legalName);
  const token = await createPendingSubscription(prisma as never, {
    organizationId: organization.id,
    email: valid.email,
    name: valid.name,
    company: valid.company,
    consentText: wording,
    source: `subscribe-form:/subscribe/${slug}`,
  });
  if (token) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://leadpilot.live";
    const mail = confirmationEmail({ senderName: sender.legalName, confirmUrl: `${appUrl}/subscribe/confirm?token=${token}`, consentText: wording });
    const sent = await sendSubscriptionConfirmation(organization.id, valid.email, mail.subject, mail.text);
    if (!sent) return back("closed");
  }
  // The same answer whether or not an email was sent, so the form does not reveal who is subscribed or suppressed.
  return back("check-inbox");
}

export default async function SubscribePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string }> }) {
  const { slug } = await params;
  const { status } = await searchParams;
  const sender = senderIdentityFromEnv();
  const organization = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
  if (!sender || !organization) {
    return <main className="mx-auto max-w-lg px-6 py-16"><h1 className="font-display text-3xl">Subscriptions are not open.</h1></main>;
  }
  const messages: Record<string, string> = {
    "check-inbox": "Check your inbox and confirm. Nothing is sent to you until you confirm.",
    invalid: "Enter a valid email address and tick the box.",
    limited: "Too many attempts. Try again later.",
    closed: "Subscriptions are not open.",
  };
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="font-display text-3xl">Get emails from {sender.legalName}</h1>
      {status && messages[status] ? <p className="mt-4 rounded border p-3">{messages[status]}</p> : null}
      <form action={subscribe} className="mt-6 space-y-4">
        <input type="hidden" name="slug" value={slug} />
        <label className="block">Email<input name="email" type="email" required className="mt-1 w-full rounded border p-2" /></label>
        <label className="block">Name (optional)<input name="name" className="mt-1 w-full rounded border p-2" /></label>
        <label className="block">Company (optional)<input name="company" className="mt-1 w-full rounded border p-2" /></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" name="consent" value="yes" /> <span>{consentText(sender.legalName)}</span></label>
        <p className="text-sm">We use your details only to send these emails. Read the <Link href="/privacy" className="underline">privacy notice</Link>.</p>
        <button type="submit" className="rounded border px-4 py-2">Subscribe</button>
      </form>
    </main>
  );
}
