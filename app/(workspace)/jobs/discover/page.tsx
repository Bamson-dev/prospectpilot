import { enqueueJobSearch } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { jobDiscoveryEnabled } from "@/lib/applications/config";
import { DISCOVERY_QUERIES } from "@/lib/applications/discover";

export const metadata = { title: "Discover jobs" };

export default async function DiscoverJobsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  await requireOrganization();
  const query = await searchParams;
  return (
    <div>
      <PageHeader title="Discover jobs" detail="Searches public pages through SearXNG. Google and Brave stay off. This does not submit applications." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      <Panel>
        <p className="text-sm text-muted">{jobDiscoveryEnabled() ? "Discovery is enabled." : "JOB_DISCOVERY_ENABLED is off, so a search will not run."}</p>
        <p className="mt-2 text-sm">Supported searches: {DISCOVERY_QUERIES.join(", ")}. The fit engine decides which roles are suitable. The same vacancy is stored once.</p>
        <form action={enqueueJobSearch} className="mt-3 grid gap-2">
          <input name="query" placeholder="remote full-stack engineer" required />
          <SubmitButton pendingLabel="Queuing">Queue search</SubmitButton>
        </form>
      </Panel>
    </div>
  );
}
