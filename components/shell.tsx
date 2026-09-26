import Link from "next/link";
import { logout } from "@/actions/auth";
import { SideNav } from "@/components/nav";

export function Shell({
  name,
  organization,
  pending,
  children,
}: {
  name: string;
  organization: string;
  pending: number;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[230px_1fr]">
      <aside className="border-b border-line bg-[#10161c] px-4 py-4 md:border-b-0 md:border-r">
        <Link href="/dashboard" className="font-display text-2xl">ProspectPilot</Link>
        <p className="mb-4 mt-1 text-xs text-muted">{organization}</p>
        <SideNav />
      </aside>
      <div>
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 md:px-8">
          <form action="/prospects" className="w-full max-w-md">
            <label className="sr-only" htmlFor="global-search">Search prospects</label>
            <input id="global-search" name="q" placeholder="Search companies" />
          </form>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/outreach" className="text-muted">{pending} pending</Link>
            <span className="text-ink">{name}</span>
            <form action={logout}><button className="button button-secondary" type="submit">Sign out</button></form>
          </div>
        </header>
        <main className="px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
