import { JobsNav } from "@/components/jobs-nav";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { fitState } from "@/lib/applications/job-pipeline";
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
  const visible = jobs.filter((job) => !query.fit || fitLabel(job) === query.fit);
  return (
    <div>
      <PageHeader title="Opportunities" detail="APPLY means verified evidence supports preparing an application. REVIEW means a material uncertainty remains. NOT A FIT means a clear blocker. Preferred gaps stay visible." />
      <JobsNav />
      <Panel className="mb-3">
        <form className="grid gap-2 md:grid-cols-4">
          <select name="fit" defaultValue={query.fit ?? ""}>
            <option value="">Any fit</option>
            <option value="APPLY">Apply</option>
            <option value="REVIEW">Review</option>
            <option value="NOT_A_FIT">Not a fit</option>
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
        return (
          <Panel key={job.id} className="mb-3">
            <p className="font-display text-2xl"><a className="text-tide" href={`/jobs/vacancies/${job.id}`}>{job.title}</a></p>
            <p className="text-sm text-muted">{job.companyName} · {job.location || "Location unknown"} · {job.remoteType || "Workplace unknown"} · {job.source}</p>
            <p className="mt-2 text-sm">Fit {fitLabel(job)}. Direct {list(explanation(job).direct)}. Missing {list(explanation(job).missingHard)}. Uncertain {list(explanation(job).uncertainHard)}.</p>
            <p className="text-sm"><a className="text-tide" href={job.applicationUrl}>Application URL</a> · Discovered {job.discoveredAt.toISOString().slice(0, 10)}</p>
          </Panel>
        );
      })}
    </div>
  );
}

function fitLabel(job: { fit: { recommendation: string; analysis: unknown } | null }) {
  const stored = readExplanation(job.fit?.analysis);
  if (stored?.state) return stored.state;
  if (!job.fit?.recommendation) return "REVIEW";
  return fitState({ recommendation: job.fit.recommendation });
}

function explanation(job: { fit: { analysis: unknown } | null }) {
  return readExplanation(job.fit?.analysis) ?? { direct: [], missingHard: [], uncertainHard: [] };
}

function list(items: Array<{ requirement: string }>) {
  if (!items.length) return "none";
  return items.map((item) => clip(item.requirement)).join("; ");
}

function clip(value: string) {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function readExplanation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as { explanation?: unknown; qualification?: unknown };
  const explanation = row.explanation;
  if (!explanation || typeof explanation !== "object" || Array.isArray(explanation)) return null;
  const item = explanation as { state?: unknown; direct?: unknown; missingHard?: unknown; uncertainHard?: unknown };
  const raw = item.state === "APPLY" || item.state === "QUALIFIED" || item.state === "REVIEW" || item.state === "NOT_A_FIT"
    ? item.state
    : row.qualification === "APPLY" || row.qualification === "QUALIFIED" || row.qualification === "REVIEW" || row.qualification === "NOT_A_FIT"
      ? row.qualification
      : null;
  const state = raw === "QUALIFIED" ? "APPLY" : raw;
  return {
    state,
    direct: rows(item.direct),
    missingHard: rows(item.missingHard),
    uncertainHard: rows(item.uncertainHard),
  };
}

function rows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { requirement?: unknown };
    return typeof row.requirement === "string" ? [{ requirement: row.requirement }] : [];
  });
}

