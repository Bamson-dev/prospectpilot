import Link from "next/link";
import { register } from "@/actions/auth";
import { Flash } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const closed = process.env.ALLOW_REGISTRATION === "false";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="font-display text-4xl">Create workspace</h1>
      <div className="mt-6"><Flash error={params.error} /></div>
      {closed ? <p className="text-sm text-muted">Registration is closed.</p> : (
        <form action={register} className="space-y-3">
          <label className="block text-sm text-muted" htmlFor="name">Your name</label>
          <input id="name" name="name" required />
          <label className="block text-sm text-muted" htmlFor="organization">Organization</label>
          <input id="organization" name="organization" required />
          <label className="block text-sm text-muted" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required />
          <label className="block text-sm text-muted" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" minLength={10} required />
          <SubmitButton pendingLabel="Creating">Create workspace</SubmitButton>
        </form>
      )}
      <p className="mt-4 text-sm text-muted"><Link className="text-tide" href="/login">Sign in</Link></p>
    </main>
  );
}
