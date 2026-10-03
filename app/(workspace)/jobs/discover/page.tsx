import { enqueueJobSearch } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { jobDiscoveryEnabled } from "@/lib/applications/config";
import { applicationStats } from "@/lib/applications/service";
import { prisma } from "@/lib/db";

export const metadata = { title: "Discover jobs" };

export default async function DiscoverJobsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; page?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
  const take = 30;
  const skip = (page - 1) * take;
  const [vacancies, totalCount, runs, activity, stats] = await Promise.all([
    prisma.jobVacancy.findMany({ where: { organizationId: organization.id }, orderBy: { discoveredAt: "desc" }, take, skip, include: { fit: true, _count: { select: { requirements: true } } } }),
    prisma.jobVacancy.count({ where: { organizationId: organization.id } }),
    prisma.backgroundJob.findMany({ where: { organizationId: organization.id, queue: "job-discovery" }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.activityLog.findFirst({ where: { organizationId: organization.id, action: "job.discovery_completed" }, orderBy: { createdAt: "desc" } }),
    applicationStats(organization.id),
  ]);
  const summary = readSummary(activity?.detail);
  const totalPages = Math.max(1, Math.ceil(totalCount / take));
  return (
    <div>
      <PageHeader title="Discover jobs" detail="Public Greenhouse and Lever listings, plus SearXNG when it is configured. This does not submit applications or send email." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      <Panel className="mb-3">
        <p className="text-sm text-muted">{jobDiscoveryEnabled() ? "Discovery is enabled." : "JOB_DISCOVERY_ENABLED is off, so a search will not run."}</p>
        <form action={enqueueJobSearch} className="mt-3 grid gap-2">
          <input name="query" placeholder="software engineer" required />
          <input name="limit" type="number" min={1} max={20} defaultValue={15} />
          <SubmitButton pendingLabel="Queuing">Start discovery</SubmitButton>
        </form>
      </Panel>
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Metric label="Jobs discovered (today)" value={stats.discovered} />
        <Metric label="Jobs qualified (today)" value={stats.qualified} />
        <Metric label="Packages ready (today)" value={stats.prepared} />
        <Metric label="Blocked / Manual Review" value={stats.blocked + stats.manual} />
      </div>
      
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Metric label="Last discovery jobs" value={summary?.discovered ?? 0} />
        <Metric label="Duplicates removed" value={summary?.duplicatesRemoved ?? 0} />
        <Metric label="Jobs stored" value={summary?.stored ?? 0} />
        <Metric label="Invalid sources" value={summary?.invalidSources ?? 0} />
      </div>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Runs</h2>
        {runs.length === 0 ? <p className="mt-2 text-sm text-muted">No discovery run has been stored.</p> : runs.map((run) => (
          <p key={run.id} className="mt-2 text-sm">{run.state} · {run.createdAt.toISOString()} · {discoveryQuery(run.payload) || "search"}{run.error ? ` · ${run.error}` : ""}</p>
        ))}
        {summary?.failures?.length ? summary.failures.map((failure) => <p key={`${failure.source}-${failure.reason}`} className="mt-2 text-sm">Failure · {failure.source} · {failure.reason}</p>) : null}
        {summary?.sources ? <p className="mt-2 text-sm">Sources · {Object.entries(summary.sources).map(([source, count]) => `${source} ${count}`).join(", ") || "none"}</p> : null}
      </Panel>
      <Panel>
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-display text-2xl">Discovered jobs</h2>
          <span className="text-sm text-muted">Showing {vacancies.length > 0 ? skip + 1 : 0}-{Math.min(skip + take, totalCount)} of {totalCount}</span>
        </div>
        {vacancies.length === 0 ? <p className="mt-2 text-sm text-muted">No vacancies stored.</p> : vacancies.map((job) => (
          <p key={job.id} className="mt-2 text-sm">
            <a className="text-tide" href={`/jobs/vacancies/${job.id}`}>{job.title}</a>
            {" · "}{job.companyName} · {job.remoteType || "remote status unknown"} · {job.source} · {job.status} · {job._count.requirements} requirements · {job.discoveredAt.toISOString().slice(0, 10)}
          </p>
        ))}
        {totalPages > 1 && (
          <div className="mt-4 flex justify-center gap-2">
            {page > 1 && <a href={`?page=${page - 1}`} className="px-3 py-1 rounded bg-muted/20 border border-line text-sm">Previous</a>}
            {page < totalPages && <a href={`?page=${page + 1}`} className="px-3 py-1 rounded bg-muted/20 border border-line text-sm">Next</a>}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Panel><p className="text-sm text-muted">{label}</p><p className="font-display text-3xl">{value}</p></Panel>;
}

function discoveryQuery(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const query = (payload as { query?: unknown }).query;
  return typeof query === "string" ? query : "";
}

function readSummary(detail: string | null | undefined) {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail) as {
      discovered?: number;
      normalized?: number;
      duplicatesRemoved?: number;
      stored?: number;
      analyzed?: number;
      qualified?: number;
      review?: number;
      notAFit?: number;
      invalidSources?: number;
      failed?: number;
      failures?: Array<{ source: string; reason: string }>;
      sources?: Record<string, number>;
    };
    return parsed;
  } catch {
    return null;
  }
}
