import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { confirmSubscription } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

// Opening the link changes nothing, so mail scanners cannot confirm on someone's behalf.
async function confirm(formData: FormData) {
  "use server";
  const result = await confirmSubscription(prisma as never, String(formData.get("token") ?? ""));
  redirect(`/subscribe/confirm?done=${result ? "1" : "0"}`);
}

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string; done?: string }> }) {
  const { token, done } = await searchParams;
  if (done === "1") return <main className="mx-auto max-w-lg px-6 py-16"><h1 className="font-display text-3xl">You are subscribed.</h1><p className="mt-4">Every email has an unsubscribe link.</p></main>;
  if (done === "0" || !token) return <main className="mx-auto max-w-lg px-6 py-16"><h1 className="font-display text-3xl">This confirmation link is not valid or has expired.</h1></main>;
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="font-display text-3xl">Confirm your subscription</h1>
      <form action={confirm} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="rounded border px-4 py-2">Confirm</button>
      </form>
    </main>
  );
}
