import { enqueueApplicationPreparation } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Qualified jobs" };

export default async function QualifiedJobsPage() {
  const { organization } = await requireOrganization();
  const jobs = await prisma.jobVacancy.findMany({
    where: { organizationId: organization.id, status: "QUALIFIED" },
    orderBy: { createdAt: "desc" },
    include: { fit: true },
    take: 50,
  });
  return (
    <div>
      <PageHeader title="Qualified jobs" detail="Match scores use verified evidence. Missing requirements stay visible." />
      <JobsNav />
      {jobs.length === 0 ? <Empty title="No qualified jobs" detail="Prepare a discovered vacancy to score it." /> : jobs.map((job) => (
        <Panel key={job.id} className="mb-3">
          <p className="font-display text-2xl">{job.title}</p>
          <p className="text-sm text-muted">{job.companyName} · {job.fit?.profile} · {job.fit?.overallMatch ?? "—"}</p>
          {job.fit ? <p className="mt-2 text-sm">Gaps: {Array.isArray(job.fit.gaps) ? (job.fit.gaps as string[]).join("; ") || "None recorded" : "None recorded"}</p> : null}
          <form action={enqueueApplicationPreparation} className="mt-2">
            <input type="hidden" name="vacancyId" value={job.id} />
            <SubmitButton pendingLabel="Queuing">Prepare again</SubmitButton>
          </form>
        </Panel>
      ))}
    </div>
  );
}
