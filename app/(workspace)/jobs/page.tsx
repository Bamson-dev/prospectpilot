import { enqueueApplicationPreparation } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Empty, Flash, PageHeader, Panel, Pill } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { applicationDailyTarget } from "@/lib/applications/config";
import { applicationStats } from "@/lib/applications/service";

export const metadata = { title: "Job applications" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const [stats, jobs, applications] = await Promise.all([
    applicationStats(organization.id),
    prisma.jobVacancy.findMany({ where: { organizationId: organization.id, status: { notIn: ["ARCHIVED", "DUPLICATE"] } }, orderBy: { createdAt: "desc" }, take: 8, include: { fit: true } }),
    prisma.jobApplication.findMany({ where: { organizationId: organization.id }, orderBy: { createdAt: "desc" }, take: 8, include: { vacancy: true } }),
  ]);
  const target = applicationDailyTarget();
  return (
    <div>
      <PageHeader title="Job applications" detail="This is separate from sales outreach. The daily number below is a target, not a count of successful submissions." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Panel><p className="text-sm text-muted">Today&apos;s target</p><p className="font-display text-3xl">{target}</p></Panel>
        <Panel><p className="text-sm text-muted">Discovered today</p><p className="font-display text-3xl">{stats.discovered}</p></Panel>
        <Panel><p className="text-sm text-muted">Qualified today</p><p className="font-display text-3xl">{stats.qualified}</p></Panel>
        <Panel><p className="text-sm text-muted">CVs generated today</p><p className="font-display text-3xl">{stats.cvs}</p></Panel>
        <Panel><p className="text-sm text-muted">Prepared today</p><p className="font-display text-3xl">{stats.prepared}</p></Panel>
        <Panel><p className="text-sm text-muted">Submitted today</p><p className="font-display text-3xl">{stats.submitted}</p></Panel>
        <Panel><p className="text-sm text-muted">Verified today</p><p className="font-display text-3xl">{stats.verified}</p></Panel>
        <Panel><p className="text-sm text-muted">Failed / blocked / manual</p><p className="font-display text-3xl">{stats.failed} / {stats.blocked} / {stats.manual}</p></Panel>
      </div>
      <Panel className="mb-4">
        <h2 className="font-display text-2xl">Throughput</h2>
        <p className="mt-2 text-sm text-muted">The target is {target} application attempts in a day. That number has not been benchmarked. CPU, memory, Redis latency, PostgreSQL latency, and per-hour rates are not measured here. Submitted today is {stats.submitted}.</p>
      </Panel>
      {jobs.length === 0 ? <Empty title="No vacancies yet" detail="Discover jobs after SearXNG and job discovery are enabled. Nothing is submitted automatically." /> : jobs.map((job) => (
        <Panel key={job.id} className="mb-3">
          <p className="font-display text-2xl">{job.title}</p>
          <p className="text-sm text-muted">{job.companyName} · {job.status} {job.fit ? `· match ${job.fit.overallMatch}` : ""}</p>
          <div className="mt-2 flex gap-2">
            <Pill>{job.source}</Pill>
            <form action={enqueueApplicationPreparation}>
              <input type="hidden" name="vacancyId" value={job.id} />
              <SubmitButton pendingLabel="Queuing">Prepare application</SubmitButton>
            </form>
          </div>
        </Panel>
      ))}
      {applications.length > 0 ? <Panel className="mt-4"><h2 className="font-display text-2xl">Recent applications</h2>{applications.map((item) => <p key={item.id} className="mt-2 text-sm"><a className="text-tide" href={`/jobs/applications/${item.id}`}>{item.vacancy.title}</a> · {item.status}</p>)}</Panel> : null}
    </div>
  );
}
