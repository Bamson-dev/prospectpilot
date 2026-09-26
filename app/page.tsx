import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/current-user";

export default async function HomePage() {
  const session = await readSession();
  if (session) redirect("/dashboard");
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-clay">B2B prospecting</p>
      <h1 className="mt-3 max-w-3xl font-display text-5xl leading-tight md:text-6xl">Find the company. Read the public evidence. Approve the email before it leaves.</h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-muted">
        ProspectPilot discovers companies, researches their websites, qualifies commercial opportunities, and holds every outreach message for review.
      </p>
      <div className="mt-8 flex gap-3">
        <Link className="button button-primary" href="/register">Create workspace</Link>
        <Link className="button button-secondary" href="/login">Sign in</Link>
      </div>
    </main>
  );
}
