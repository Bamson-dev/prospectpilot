import { notFound } from "next/navigation";
import { decideApplication, enqueueApplicationPreparation } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Application review" };

export default async function ApplicationReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const { id } = await params;
  const query = await searchParams;
  const application = await prisma.jobApplication.findFirst({
    where: { id, organizationId: organization.id },
    include: {
      vacancy: { include: { requirements: true, fit: true } },
      package: true,
      answers: true,
      events: { orderBy: { createdAt: "desc" }, take: 30 },
      followUps: true,
      candidate: true,
    },
  });
  if (!application) notFound();
  const documents = await prisma.generatedDocument.findMany({
    where: { organizationId: organization.id, vacancyId: application.vacancyId, archived: false },
    orderBy: { createdAt: "desc" },
  });
  const analysis = readAnalysis(application.vacancy.fit?.analysis);
  const cv = documents.find((document) => document.kind === "CV");
  const letter = documents.find((document) => document.kind === "COVER_LETTER");
  return (
    <div>
      <PageHeader title={application.vacancy.title} detail={`${application.vacancy.companyName} · ${application.status}`} />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Job</h2>
        <p className="mt-2 text-sm">{application.vacancy.companyName} · {application.vacancy.title}</p>
        <p className="text-sm text-muted">{application.vacancy.location || "Location not listed"} · {application.vacancy.remoteType || "Remote policy not listed"} · {application.vacancy.employmentType || "Employment type not listed"}</p>
        <p className="text-sm text-muted">{salary(application.vacancy.salaryMin, application.vacancy.salaryMax, application.vacancy.salaryCurrency)}</p>
        <p className="mt-2 text-sm">Source {application.source}. <a className="text-tide" href={application.applicationUrl} target="_blank" rel="noreferrer">Open application URL</a></p>
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Fit</h2>
        <p className="mt-2 text-sm">Profile {application.profile}. Recommendation {application.vacancy.fit?.recommendation ?? "—"}.</p>
        <List title="Matched requirements" items={analysis?.requiredMatches} />
        <List title="Required gaps" items={analysis?.requiredGaps} />
        <List title="Preferred matches" items={analysis?.preferredMatches} />
        <List title="Preferred gaps" items={analysis?.preferredGaps} />
        <List title="Uncertain" items={analysis?.uncertain} />
        <List title="Blockers" items={analysis?.blockers} />
        <List title="Missing candidate information" items={analysis?.missingInformation} />
        {analysis?.evidence?.length ? analysis.evidence.map((item) => <p key={item.requirement} className="mt-2 text-sm">{item.requirement} — {item.fact}</p>) : null}
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Package</h2>
        <p className="mt-2 text-sm">Selected profile {application.profile}.</p>
        {documents.filter((document) => document.kind === "CV").map((document) => <p key={document.id} className="mt-2 text-sm"><a className="text-tide" href={`/api/jobs/documents/${document.id}`}>{document.fileName}</a></p>)}
        {!cv ? <p className="mt-2 text-sm text-muted">No CV stored. A placeholder email blocks document generation.</p> : null}
        {cv ? <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-sm">{cv.text.slice(0, 1200)}</pre> : null}
        {letter ? <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-sm">{letter.text.slice(0, 1200)}</pre> : <p className="mt-2 text-sm text-muted">No cover letter stored.</p>}
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Answers</h2>
        {application.answers.map((answer) => <p key={answer.id} className="mt-2 text-sm">{answer.question} · {answer.status}{answer.answer ? ` · ${answer.answer.slice(0, 220)}` : ""}</p>)}
        <List title="Warnings" items={application.package?.warnings} />
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Review</h2>
        <p className="mt-2 text-sm text-muted">Approval does not submit the application.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={decideApplication}><input type="hidden" name="id" value={application.id} /><input type="hidden" name="decision" value="APPROVED" /><SubmitButton pendingLabel="Saving">Approve</SubmitButton></form>
          <form action={decideApplication}><input type="hidden" name="id" value={application.id} /><input type="hidden" name="decision" value="REJECTED" /><SubmitButton pendingLabel="Saving" variant="secondary">Reject</SubmitButton></form>
          <a className="inline-flex items-center rounded border border-line px-3 py-2 text-sm" href="/jobs/candidate">Edit</a>
          <form action={enqueueApplicationPreparation}><input type="hidden" name="vacancyId" value={application.vacancyId} /><input type="hidden" name="part" value="cv" /><SubmitButton pendingLabel="Queuing" variant="secondary">Regenerate CV</SubmitButton></form>
          <form action={enqueueApplicationPreparation}><input type="hidden" name="vacancyId" value={application.vacancyId} /><input type="hidden" name="part" value="letter" /><SubmitButton pendingLabel="Queuing" variant="secondary">Regenerate letter</SubmitButton></form>
        </div>
      </Panel>
      <Panel>
        <h2 className="font-display text-2xl">History</h2>
        {application.events.map((event) => <p key={event.id} className="mt-2 text-sm">{event.type}{event.detail ? ` · ${event.detail}` : ""}</p>)}
        {application.followUps.map((item) => <p key={item.id} className="mt-2 text-sm">Follow-up {item.status} · {item.channel}</p>)}
      </Panel>
    </div>
  );
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3">
      <p className="text-sm text-muted">{title}</p>
      <ul className="mt-1 list-disc pl-5 text-sm">{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}

function salary(min: number | null, max: number | null, currency: string | null) {
  if (min == null && max == null) return "Salary not listed";
  return `Salary ${min ?? "—"}–${max ?? "—"} ${currency ?? ""}`.trim();
}

function readAnalysis(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return {
    requiredMatches: strings(row.requiredMatches),
    requiredGaps: strings(row.requiredGaps),
    preferredMatches: strings(row.preferredMatches),
    preferredGaps: strings(row.preferredGaps),
    blockers: strings(row.blockers),
    uncertain: strings(row.uncertain),
    missingInformation: strings(row.missingInformation),
    evidence: Array.isArray(row.evidence)
      ? row.evidence.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const entry = item as { requirement?: unknown; fact?: unknown };
          if (typeof entry.requirement !== "string" || typeof entry.fact !== "string") return [];
          return [{ requirement: entry.requirement, fact: entry.fact }];
        })
      : [],
  };
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
