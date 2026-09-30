import { addReviewToQueue, enqueueApplicationBatch } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Empty, Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { MANUAL_QUEUE_REASON, queueAdmission, readQueueOpportunity, storedFitDecision } from "@/lib/applications/application-queue";
import { pipelineState } from "@/lib/applications/state";
import type { ApplicationStatus } from "@/lib/applications/types";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Application queue" };

export default async function ApplicationQueuePage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const vacancies = await prisma.jobVacancy.findMany({
    where: { organizationId: organization.id, status: { in: ["DISCOVERED", "ANALYZED", "QUALIFIED"] } },
    orderBy: { discoveredAt: "desc" },
    include: {
      fit: true,
      applications: { orderBy: { createdAt: "desc" }, take: 1, include: { package: true } },
    },
    take: 80,
  });
  const rows = vacancies.map((vacancy) => {
    const decision = storedFitDecision(vacancy.fit?.analysis);
    const application = vacancy.applications[0] ?? null;
    const manuallyQueued = application?.blockedReason === MANUAL_QUEUE_REASON;
    const admission = queueAdmission({ decision, manuallyQueued });
    return { vacancy, decision, application, admission, opportunity: readQueueOpportunity(vacancy.fit?.analysis) };
  });
  const queued = rows.filter((row) => row.admission !== "excluded");
  const reviewChoices = rows.filter((row) => row.decision === "REVIEW" && row.admission === "excluded");
  return (
    <div>
      <PageHeader title="Application queue" detail="Apply vacancies enter on their own. Review vacancies stay out until you add one. Not-a-fit vacancies stay out. Preparation does not submit." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      {reviewChoices.length > 0 ? (
        <Panel className="mb-3">
          <h2 className="font-display text-2xl">Add a review vacancy</h2>
          <form action={addReviewToQueue} className="mt-3 flex flex-wrap gap-2">
            <select name="vacancyId" defaultValue={reviewChoices[0]?.vacancy.id}>
              {reviewChoices.map((row) => <option key={row.vacancy.id} value={row.vacancy.id}>{row.vacancy.companyName} · {row.vacancy.title}</option>)}
            </select>
            <SubmitButton pendingLabel="Adding" variant="secondary">Add to queue</SubmitButton>
          </form>
        </Panel>
      ) : null}
      {queued.length === 0 ? <Empty title="Queue is empty" detail="Discover vacancies first. Apply results appear here. Review results appear after you add them." /> : (
        <form action={enqueueApplicationBatch}>
          {queued.map((row) => {
            const status = row.application ? pipelineState(row.application.status as ApplicationStatus) : "DRAFT";
            return (
              <Panel key={row.vacancy.id} className="mb-3">
                <label className="flex items-start gap-3">
                  <input type="checkbox" name="vacancyId" value={row.vacancy.id} />
                  <span>
                    <span className="font-display text-2xl">{row.vacancy.title}</span>
                    <span className="mt-1 block text-sm text-muted">{row.vacancy.companyName} · {row.vacancy.location || "Location not listed"} · {row.vacancy.remoteType || "Workplace not listed"}</span>
                    <span className="mt-2 block text-sm">Primary {label(row.opportunity.primaryProfile)} · Secondary {row.opportunity.secondaryProfiles.map(label).join(", ") || "none"} · {row.decision} · {row.admission}</span>
                    <span className="mt-1 block text-sm">{row.opportunity.reason || "No qualification rationale stored."}</span>
                    <span className="mt-1 block text-sm">Status {status}. Package {row.application?.package ? `v${row.application.package.version}` : "not prepared"}. Blockers {row.opportunity.blockers.slice(0, 3).join("; ") || row.application?.blockedReason || "none"}.</span>
                    <a className="mt-1 block text-sm text-tide" href={row.vacancy.applicationUrl}>Application URL</a>
                  </span>
                </label>
              </Panel>
            );
          })}
          <SubmitButton pendingLabel="Queuing">Prepare selected (max 10)</SubmitButton>
        </form>
      )}
    </div>
  );
}

function label(value: string | null) {
  if (!value) return "none";
  return value.toLowerCase().replaceAll("_", " ");
}
