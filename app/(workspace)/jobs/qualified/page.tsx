import { JobsNav } from "@/components/jobs-nav";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { selectionCounts } from "@/lib/applications/job-pipeline";
import { fitState } from "@/lib/applications/job-pipeline";
import type { FitResult } from "@/lib/applications/fit";
import { prisma } from "@/lib/db";

export const metadata = { title: "Qualified jobs" };

export default async function QualifiedJobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const jobs = await prisma.jobVacancy.findMany({
    where: {
      organizationId: organization.id,
      status: { in: ["DISCOVERED", "ANALYZED", "QUALIFIED"] },
      ...(query.company ? { companyName: { contains: query.company, mode: "insensitive" } } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.remote ? { remoteType: query.remote } : {}),
      ...(query.employment ? { employmentType: { contains: query.employment, mode: "insensitive" } } : {}),
      ...(query.location ? { location: { contains: query.location, mode: "insensitive" } } : {}),
      ...(query.technology ? { requirements: { some: { text: { contains: query.technology, mode: "insensitive" } } } } : {}),
      ...(query.since ? { discoveredAt: { gte: new Date(query.since) } } : {}),
    },
    orderBy: { discoveredAt: "desc" },
    include: { fit: true },
    take: 80,
  });
  const visible = jobs.filter((job) => !query.fit || fitLabel(job.fit?.recommendation) === query.fit);
  return (
    <div>
      <PageHeader title="Qualified jobs" detail="Missing requirements stay visible. The fit state comes from verified evidence, not an unexplained score." />
      <JobsNav />
      <Panel className="mb-3">
        <form className="grid gap-2 md:grid-cols-4">
          <select name="fit" defaultValue={query.fit ?? ""}>
            <option value="">Any fit</option>
            <option value="QUALIFIED">Qualified</option>
            <option value="REVIEW">Review</option>
            <option value="NOT_READY">Not ready</option>
          </select>
          <input name="location" defaultValue={query.location ?? ""} placeholder="Location" />
          <select name="remote" defaultValue={query.remote ?? ""}>
            <option value="">Any workplace</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="on-site">On-site</option>
          </select>
          <input name="technology" defaultValue={query.technology ?? ""} placeholder="Technology" />
          <input name="employment" defaultValue={query.employment ?? ""} placeholder="Employment type" />
          <input name="source" defaultValue={query.source ?? ""} placeholder="Source" />
          <input name="company" defaultValue={query.company ?? ""} placeholder="Company" />
          <input name="since" type="date" defaultValue={query.since ?? ""} />
          <button className="rounded border border-line px-3 py-2 text-sm" type="submit">Filter</button>
        </form>
      </Panel>
      {visible.length === 0 ? <Empty title="No jobs" detail="Discovery has not stored a vacancy for this filter." /> : visible.map((job) => {
        const counts = countsFrom(job.fit?.analysis);
        return (
          <Panel key={job.id} className="mb-3">
            <p className="font-display text-2xl"><a className="text-tide" href={`/jobs/vacancies/${job.id}`}>{job.title}</a></p>
            <p className="text-sm text-muted">{job.companyName} · {job.location || "Location unknown"} · {job.remoteType || "Workplace unknown"} · {job.source}</p>
            <p className="mt-2 text-sm">Fit {fitLabel(job.fit?.recommendation)}. Direct {counts.direct}. Transferable {counts.transferable}. Uncertain {counts.uncertain}. Missing {counts.missing}.</p>
            <p className="text-sm"><a className="text-tide" href={job.applicationUrl}>Application URL</a> · Discovered {job.discoveredAt.toISOString().slice(0, 10)}</p>
          </Panel>
        );
      })}
    </div>
  );
}

function fitLabel(recommendation: string | null | undefined) {
  if (!recommendation) return "REVIEW";
  return fitState({ recommendation } as Pick<FitResult, "recommendation">);
}

function countsFrom(analysis: unknown) {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return { direct: 0, transferable: 0, uncertain: 0, missing: 0 };
  const selections = (analysis as { selections?: unknown }).selections;
  if (!Array.isArray(selections)) return { direct: 0, transferable: 0, uncertain: 0, missing: 0 };
  return selectionCounts({ selections } as FitResult);
}
