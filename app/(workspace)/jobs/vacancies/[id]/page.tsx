import { notFound } from "next/navigation";
import { JobsNav } from "@/components/jobs-nav";
import { PageHeader, Panel } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { fitState } from "@/lib/applications/job-pipeline";
import type { FitResult } from "@/lib/applications/fit";
import { prisma } from "@/lib/db";

export const metadata = { title: "Vacancy" };

export default async function VacancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { organization } = await requireOrganization();
  const { id } = await params;
  const job = await prisma.jobVacancy.findFirst({
    where: { id, organizationId: organization.id },
    include: { requirements: true, fit: true },
  });
  if (!job) notFound();
  const selections = readSelections(job.fit?.analysis);
  const original = readOriginal(job.rawData);
  return (
    <div>
      <PageHeader title={job.title} detail={`${job.companyName} · ${fitState({ recommendation: job.fit?.recommendation ?? "REVIEW" } as Pick<FitResult, "recommendation">)}`} />
      <JobsNav />
      <Panel className="mb-3">
        <p className="text-sm">{job.location || "Location unknown"} · {job.remoteType || "Workplace unknown"} · {job.employmentType || "Employment type unknown"}</p>
        <p className="mt-2 text-sm">Source {job.source}{job.externalId ? ` · ${job.externalId}` : ""} · Discovered {job.discoveredAt.toISOString()}</p>
        <p className="mt-2 text-sm">Posted {job.postedAt ? job.postedAt.toISOString().slice(0, 10) : "unknown"} · Salary {job.salaryMin == null && job.salaryMax == null ? "not stated" : `${job.salaryMin ?? "—"}–${job.salaryMax ?? "—"} ${job.salaryCurrency ?? ""}`}</p>
        <p className="mt-2 text-sm"><a className="text-tide" href={original.sourceUrl || job.sourceUrl}>Original source</a> · <a className="text-tide" href={original.applicationUrl || job.applicationUrl}>Application URL</a></p>
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Requirements</h2>
        {job.requirements.length === 0 ? <p className="mt-2 text-sm text-muted">No requirements have been extracted.</p> : job.requirements.map((item) => (
          <p key={item.id} className="mt-2 text-sm">{item.kind} · {item.required ? "Required" : "Not a hard requirement"} · {item.text}</p>
        ))}
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Candidate fit</h2>
        {selections.length === 0 ? <p className="mt-2 text-sm text-muted">Fit has not been stored.</p> : selections.map((item) => (
          <p key={`${item.requirement}-${item.match}`} className="mt-2 text-sm">Requirement: {item.requirement}. Classification: {item.match}. Evidence: {item.evidence || "None"}. Reason: {item.reason || "No reason stored."}</p>
        ))}
      </Panel>
      <Panel>
        <h2 className="font-display text-2xl">Description</h2>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-sm">{job.description}</pre>
      </Panel>
    </div>
  );
}

function readSelections(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const selections = (value as { selections?: unknown }).selections;
  if (!Array.isArray(selections)) return [];
  return selections.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { requirement?: unknown; match?: unknown; evidence?: unknown; reason?: unknown };
    if (typeof row.requirement !== "string" || typeof row.match !== "string") return [];
    return [{ requirement: row.requirement, match: row.match, evidence: typeof row.evidence === "string" ? row.evidence : "", reason: typeof row.reason === "string" ? row.reason : "" }];
  });
}

function readOriginal(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { sourceUrl: "", applicationUrl: "" };
  const row = value as { originalSourceUrl?: unknown; originalApplicationUrl?: unknown };
  return {
    sourceUrl: typeof row.originalSourceUrl === "string" ? row.originalSourceUrl : "",
    applicationUrl: typeof row.originalApplicationUrl === "string" ? row.originalApplicationUrl : "",
  };
}
