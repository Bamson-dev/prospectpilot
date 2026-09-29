import { notFound } from "next/navigation";
import { JobsNav } from "@/components/jobs-nav";
import { PageHeader, Panel } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { fitState } from "@/lib/applications/job-pipeline";
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
  const explanation = readExplanation(job.fit?.analysis);
  const selections = readSelections(job.fit?.analysis);
  const original = readOriginal(job.rawData);
  const opportunity = explanation?.opportunity ?? null;
  const state = displayState(explanation?.state ?? fitState({ recommendation: job.fit?.recommendation ?? "REVIEW" }));
  return (
    <div>
      <PageHeader title={job.title} detail={`${job.companyName} · ${label(state)}`} />
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
        <h2 className="font-display text-2xl">{label(state)}</h2>
        {opportunity ? (
          <div className="mt-2 text-sm">
            <p>Career lane: {opportunity.lanes.join(", ") || "Unknown"}</p>
            <p>Primary profile: {opportunity.primaryProfile ?? "None"}</p>
            <p>Secondary profiles: {opportunity.secondaryProfiles.join(", ") || "None"}</p>
            <p>Document profile: {opportunity.documentProfile}</p>
            <p className="mt-2">{opportunity.reason}</p>
            <Group title="Direct evidence" items={opportunity.direct} />
            <Group title="Transferable evidence" items={opportunity.transferable} />
            <Group title="Adjacent evidence" items={opportunity.adjacent} />
            <Group title="Experience-based evidence" items={opportunity.experienceBased} />
            <Group title="Stretch evidence" items={opportunity.stretch} />
            <Group title="Unknown requirements" items={opportunity.unknown} />
            <Group title="Disqualifiers" items={opportunity.disqualifiers} />
            <p className="mt-2">Missing preferred: {opportunity.missingPreferred.join("; ") || "None"}</p>
            <p>Evidence gaps: {opportunity.gaps.join("; ") || "None"}</p>
          </div>
        ) : null}
        <Group title="Direct matches" items={explanation?.direct ?? []} />
        <Group title="Transferable matches" items={explanation?.transferable ?? []} />
        <Group title="Missing hard requirements" items={explanation?.missingHard ?? []} />
        <Group title="Uncertain hard requirements" items={explanation?.uncertainHard ?? []} />
        <Group title="Preferred requirements" items={explanation?.preferred ?? []} />
        <h3 className="mt-4 text-sm font-medium">Responsibilities</h3>
        {(explanation?.responsibilities.length ?? 0) === 0 ? <p className="mt-2 text-sm text-muted">None separated from the requirements.</p> : explanation?.responsibilities.map((item) => <p key={item} className="mt-2 text-sm">{item}</p>)}
        {explanation ? null : selections.map((item) => (
          <p key={`${item.requirement}-${item.match}`} className="mt-2 text-sm">Requirement: {item.requirement}. Classification: {item.match}. Candidate evidence: {item.evidence || "None"}. Source: {item.source || "None"}. Verification: {item.evidence && (item.match === "DIRECT" || item.match === "TRANSFERABLE") ? "VERIFIED" : "Not used"}. Reason: {item.reason || "No reason stored."}</p>
        ))}
      </Panel>
      <Panel>
        <h2 className="font-display text-2xl">Description</h2>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-sm">{job.description}</pre>
      </Panel>
    </div>
  );
}

function label(state: string) {
  if (state === "NOT_A_FIT") return "NOT A FIT";
  if (state === "QUALIFIED") return "APPLY";
  return state;
}

function displayState(state: string) {
  return state === "QUALIFIED" ? "APPLY" : state;
}

function Group({ title, items }: { title: string; items: Array<{ requirement: string; evidence?: string | null; reason?: string; source?: string | null; verification?: string | null }> }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length === 0 ? <p className="mt-2 text-sm text-muted">None</p> : items.map((item) => (
        <p key={`${title}-${item.requirement}`} className="mt-2 text-sm">Requirement: {item.requirement}.{item.evidence ? ` Candidate evidence: ${item.evidence}.` : ""}{item.source ? ` Source: ${item.source}.` : ""}{item.verification ? ` Verification: ${item.verification}.` : ""}{item.reason ? ` ${item.reason}` : ""}</p>
      ))}
    </div>
  );
}

function readExplanation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const explanation = (value as { explanation?: unknown }).explanation;
  if (!explanation || typeof explanation !== "object" || Array.isArray(explanation)) return null;
  const row = explanation as Record<string, unknown>;
  const state = row.state === "APPLY" || row.state === "QUALIFIED" || row.state === "REVIEW" || row.state === "NOT_A_FIT" ? row.state : "REVIEW";
  const opportunity = readOpportunity(row.opportunity);
  return {
    state,
    opportunity,
    direct: detailRows(row.direct),
    transferable: detailRows(row.transferable),
    missingHard: detailRows(row.missingHard),
    uncertainHard: detailRows(row.uncertainHard),
    preferred: detailRows(row.preferred),
    responsibilities: Array.isArray(row.responsibilities) ? row.responsibilities.filter((item): item is string => typeof item === "string") : [],
  };
}

function readOpportunity(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const links = (key: string) => detailRows(row[key]).map((item) => ({ requirement: item.requirement, evidence: item.evidence, reason: item.reason }));
  return {
    lanes: Array.isArray(row.lanes) ? row.lanes.filter((item): item is string => typeof item === "string") : [],
    primaryProfile: typeof row.primaryProfile === "string" ? row.primaryProfile : null,
    secondaryProfiles: Array.isArray(row.secondaryProfiles) ? row.secondaryProfiles.filter((item): item is string => typeof item === "string") : [],
    documentProfile: typeof row.documentProfile === "string" ? row.documentProfile : "",
    reason: typeof row.reason === "string" ? row.reason : "",
    direct: links("direct"),
    transferable: links("transferable"),
    adjacent: links("adjacent"),
    experienceBased: links("experienceBased"),
    stretch: links("stretch"),
    unknown: links("unknown"),
    disqualifiers: links("disqualifiers"),
    missingPreferred: Array.isArray(row.missingPreferred) ? row.missingPreferred.filter((item): item is string => typeof item === "string") : [],
    gaps: Array.isArray(row.gaps) ? row.gaps.filter((item): item is string => typeof item === "string") : [],
  };
}

function detailRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { requirement?: unknown; evidence?: unknown; reason?: unknown; source?: unknown; verification?: unknown };
    if (typeof row.requirement !== "string") return [];
    return [{
      requirement: row.requirement,
      evidence: typeof row.evidence === "string" ? row.evidence : null,
      reason: typeof row.reason === "string" ? row.reason : "",
      source: typeof row.source === "string" ? row.source : null,
      verification: row.verification === "VERIFIED" ? "VERIFIED" : null,
    }];
  });
}

function readSelections(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const selections = (value as { selections?: unknown }).selections;
  if (!Array.isArray(selections)) return [];
  return selections.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { requirement?: unknown; match?: unknown; evidence?: unknown; reason?: unknown; source?: unknown };
    if (typeof row.requirement !== "string" || typeof row.match !== "string") return [];
    return [{ requirement: row.requirement, match: row.match, evidence: typeof row.evidence === "string" ? row.evidence : "", reason: typeof row.reason === "string" ? row.reason : "", source: typeof row.source === "string" ? row.source : "" }];
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
