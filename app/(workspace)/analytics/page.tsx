import { PageHeader, Panel } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { discoveryToday, rate, workspaceMetrics } from "@/lib/metrics";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const { organization } = await requireOrganization();
  const metrics = await workspaceMetrics(organization.id);
  const today = await discoveryToday(organization.id);
  const rows = [
    ["Raw results today", today.raw, "discovery sources"],
    ["Unique companies today", today.companies, "new prospects"],
    ["Duplicates today", today.duplicates, "existing companies"],
    ["SearXNG today", today.sources.search, "search results"],
    ["Directories today", today.sources.directory, "directory results"],
    ["Emails today", today.emails, "public addresses"],
    ["Software opportunities today", today.software, "stored assessments"],
    ["Advertising opportunities today", today.advertising, "stored assessments"],
    ["Discovery stored", metrics.prospects, "companies"],
    ["Research completion", rate(metrics.researched, metrics.prospects), "% of prospects"],
    ["Qualification", rate(metrics.qualified, metrics.prospects), "% of prospects"],
    ["Approval", rate(metrics.approved, metrics.qualified), "% of qualified"],
    ["Send", rate(metrics.sent, metrics.approved), "% of approved"],
    ["Delivery", rate(metrics.delivered, metrics.sent), "% of sent, when the provider reports it"],
    ["Reply", rate(metrics.replies, metrics.sent), "% of sent"],
    ["Interested", rate(metrics.interested, metrics.replies), "% of replies"],
    ["Meeting", rate(metrics.meetings, metrics.replies), "% of replies"],
  ];
  return (
    <div>
      <PageHeader title="Analytics" detail="Rates are calculated from stored records. They are zero until those records exist." />
      <div className="grid gap-3 md:grid-cols-3">
        {rows.map(([label, value, detail]) => (
          <Panel key={String(label)}><p className="text-xs uppercase tracking-wider text-muted">{label}</p><p className="mt-2 font-display text-3xl">{value}</p><p className="text-sm text-muted">{detail}</p></Panel>
        ))}
      </div>
    </div>
  );
}
