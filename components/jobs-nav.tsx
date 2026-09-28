import Link from "next/link";

const LINKS = [
  ["/jobs", "Overview"],
  ["/jobs/discover", "Discover"],
  ["/jobs/qualified", "Qualified"],
  ["/jobs/applications", "Applications"],
  ["/jobs/candidate", "Candidate"],
  ["/jobs/cv-library", "CV library"],
  ["/jobs/settings", "Settings"],
] as const;

export function JobsNav() {
  return (
    <div className="mb-4 flex flex-wrap gap-2 text-sm">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className="rounded-full border border-line px-3 py-1 text-muted hover:text-ink">{label}</Link>
      ))}
    </div>
  );
}
