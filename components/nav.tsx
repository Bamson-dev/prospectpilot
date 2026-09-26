"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/dashboard", "Dashboard"],
  ["/campaigns", "Campaigns"],
  ["/prospects", "Prospects"],
  ["/research", "Research"],
  ["/outreach", "Outreach"],
  ["/inbox", "Inbox"],
  ["/follow-ups", "Follow-ups"],
  ["/contacts", "Contacts"],
  ["/analytics", "Analytics"],
  ["/integrations", "Integrations"],
  ["/settings", "Settings"],
] as const;

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {LINKS.map(([href, label]) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-xl px-3 py-2 text-sm ${active ? "bg-panel-2 text-tide" : "text-muted hover:text-ink"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
