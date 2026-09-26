import Link from "next/link";
import { login } from "@/actions/auth";
import { Flash } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="font-display text-4xl">Sign in</h1>
      <div className="mt-6"><Flash error={params.error} /></div>
      <form action={login} className="space-y-3">
        <label className="block text-sm text-muted" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <label className="block text-sm text-muted" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        <SubmitButton pendingLabel="Signing in">Sign in</SubmitButton>
      </form>
      <p className="mt-4 text-sm text-muted">No workspace yet? <Link className="text-tide" href="/register">Create one</Link></p>
    </main>
  );
}
