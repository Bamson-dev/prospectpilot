import { confirmEvidenceItem, importEvidence, promoteProjectTechnologies, rejectEvidenceItem, removeEvidence, saveEvidence } from "@/actions/candidate-evidence";
import { JobsNav } from "@/components/jobs-nav";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { durationLabel, EVIDENCE_TYPES, factIsAutomaticEvidence, groupEvidence, PROFILE_LABELS, CAREER_PROFILES, toEvidenceRecord, verifiedConflicts } from "@/lib/applications/evidence-management";
import { ensureCandidate } from "@/lib/applications/service";
import { prisma } from "@/lib/db";

export const metadata = { title: "Candidate evidence" };

export default async function CandidateEvidencePage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const row = await ensureCandidate(organization.id);
  const candidate = await prisma.candidate.findFirst({
    where: { id: row.id, organizationId: organization.id },
    include: {
      facts: { orderBy: { updatedAt: "desc" } },
      factEvents: { orderBy: { createdAt: "desc" }, take: 40 },
      projects: { orderBy: { name: "asc" } },
      experiences: { orderBy: { title: "asc" } },
    },
  });
  if (!candidate) return null;
  const records = candidate.facts.map((fact) => toEvidenceRecord(fact));
  const groups = groupEvidence(records);
  const conflicts = verifiedConflicts(records);
  const pending = records.filter((record) => record.verification === "PENDING_REVIEW" || record.verification === "REVIEW_REQUIRED");
  return (
    <div>
      <PageHeader title="Candidate evidence" detail="Only verified candidate-entered or verified-source evidence is used for qualification, CVs, and cover letters. Imports stay in review until you confirm them." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Add evidence</h2>
        <form action={saveEvidence} className="mt-3 grid gap-2">
          <input name="claim" placeholder="Claim" required />
          <TypeSelect />
          <input name="source" placeholder="Source" required />
          <input name="duration" placeholder="Duration, only if you know it" />
          <VerificationSelect />
          <ProfileFields />
          <SubmitButton pendingLabel="Saving">Save evidence</SubmitButton>
        </form>
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Import for review</h2>
        <p className="mt-2 text-sm text-muted">JSON or CSV. Every imported row stays pending until you confirm it. A verified fact is not replaced by an import.</p>
        <form action={importEvidence} className="mt-3 grid gap-2">
          <textarea name="import" rows={6} placeholder={'[{"claim":"GraphQL","type":"TECHNOLOGY","source":"notes","profiles":["SOFTWARE"]}]'} required />
          <SubmitButton pendingLabel="Importing">Import evidence</SubmitButton>
        </form>
      </Panel>
      {conflicts.length ? (
        <Panel className="mb-3">
          <h2 className="font-display text-2xl">Conflicts</h2>
          {conflicts.map((conflict) => <p key={conflict} className="mt-2 text-sm">{conflict}</p>)}
        </Panel>
      ) : null}
      {pending.length ? (
        <Panel className="mb-3">
          <h2 className="font-display text-2xl">Needs review</h2>
          {pending.map((record) => (
            <div key={record.id} className="mt-3 border-t border-line pt-3">
              <EvidenceLine record={record} />
              <div className="mt-2 flex gap-2">
                <form action={confirmEvidenceItem}><input type="hidden" name="id" value={record.id} /><SubmitButton pendingLabel="Confirming">Confirm</SubmitButton></form>
                <form action={rejectEvidenceItem}><input type="hidden" name="id" value={record.id} /><SubmitButton pendingLabel="Rejecting">Reject</SubmitButton></form>
              </div>
            </div>
          ))}
        </Panel>
      ) : null}
      {groups.map((group) => (
        <Panel key={group.title} className="mb-3">
          <h2 className="font-display text-2xl">{group.title}</h2>
          {group.items.length === 0 ? <p className="mt-2 text-sm text-muted">None on file.</p> : group.items.map((record) => (
            <div key={record.id} className="mt-3 border-t border-line pt-3">
              <EvidenceLine record={record} />
              <p className="mt-1 text-sm">{factIsAutomaticEvidence({ verified: record.verification === "VERIFIED", verification: record.verification, sourceType: record.storedOrigin, source: record.source, fact: record.claim }) ? "Used for automatic qualification." : "Not used for automatic qualification."}</p>
              <form action={saveEvidence} className="mt-2 grid gap-2">
                <input type="hidden" name="claim" value={record.claim} />
                <input type="hidden" name="type" value={record.type} />
                <input name="source" defaultValue={record.source} placeholder="Source" required />
                <input name="duration" defaultValue={record.duration ?? ""} placeholder="Duration, only if you know it" />
                <VerificationSelect current={record.verification} />
                <ProfileFields selected={record.profiles} />
                <SubmitButton pendingLabel="Saving">Update evidence</SubmitButton>
              </form>
              <form action={removeEvidence} className="mt-2">
                <input type="hidden" name="id" value={record.id} />
                <SubmitButton pendingLabel="Removing">Remove evidence</SubmitButton>
              </form>
            </div>
          ))}
        </Panel>
      ))}
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Projects</h2>
        <p className="mt-2 text-sm text-muted">Listed technologies become technology evidence only when you confirm them. A project description does not add technologies.</p>
        {candidate.projects.length === 0 ? <p className="mt-2 text-sm text-muted">None on file.</p> : candidate.projects.map((project) => (
          <div key={project.id} className="mt-3 text-sm">
            <p>{project.name} · {project.role} · {project.verified ? "Verified project" : "Unverified project"} · {project.technologies.join(", ") || "No listed technologies"} · Duration UNKNOWN</p>
            <form action={promoteProjectTechnologies} className="mt-2">
              <input type="hidden" name="id" value={project.id} />
              <SubmitButton pendingLabel="Saving">Confirm listed technologies</SubmitButton>
            </form>
          </div>
        ))}
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Professional experience records</h2>
        {candidate.experiences.length === 0 ? <p className="mt-2 text-sm text-muted">None on file.</p> : candidate.experiences.map((item) => (
          <p key={item.id} className="mt-2 text-sm">{item.title}, {item.organizationName}. {item.summary} Duration UNKNOWN. {item.verified ? "Verified" : "Unverified"}.</p>
        ))}
      </Panel>
      <Panel>
        <h2 className="font-display text-2xl">Evidence history</h2>
        {candidate.factEvents.length === 0 ? <p className="mt-2 text-sm text-muted">No evidence changes yet.</p> : candidate.factEvents.map((event) => (
          <p key={event.id} className="mt-2 text-sm">{event.createdAt.toISOString()} · {event.action} · {event.detail}</p>
        ))}
      </Panel>
    </div>
  );
}

function EvidenceLine({ record }: { record: ReturnType<typeof toEvidenceRecord> }) {
  const verificationColor = record.verification === "VERIFIED" ? "bg-green-100 text-green-800 border-green-200" :
    record.verification === "PENDING_REVIEW" ? "bg-yellow-100 text-yellow-800 border-yellow-200" :
    record.verification === "REVIEW_REQUIRED" ? "bg-orange-100 text-orange-800 border-orange-200" : "bg-gray-100 text-gray-800 border-gray-200";

  return (
    <div className="text-sm flex flex-col gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <strong className="text-base">{record.claim}</strong>
        <span className="text-xs text-muted uppercase tracking-wider">{record.type}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${verificationColor} uppercase tracking-wider font-medium`}>
          {record.verification}
        </span>
        <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full capitalize">
          {record.origin.replace(/_/g, " ").toLowerCase()}
        </span>
      </div>
      <div className="text-muted text-xs flex gap-3">
        <span>Source: <span className="text-ink">{record.source}</span></span>
        <span>Profiles: {record.profiles.map((profile) => PROFILE_LABELS[profile]).join(", ") || "None"}</span>
        <span>Duration: {durationLabel(record.duration)}</span>
        <span>Updated: {new Date(record.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function TypeSelect() {
  return (
    <select name="type" defaultValue="TECHNOLOGY">
      {EVIDENCE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
    </select>
  );
}

function VerificationSelect({ current }: { current?: string }) {
  const value = current === "VERIFIED" || current === "REVIEW_REQUIRED" || current === "UNVERIFIED" ? current : "UNVERIFIED";
  return (
    <select name="verification" defaultValue={value}>
      <option value="UNVERIFIED">UNVERIFIED</option>
      <option value="REVIEW_REQUIRED">REVIEW_REQUIRED</option>
      <option value="VERIFIED">VERIFIED</option>
    </select>
  );
}

function ProfileFields({ selected = [] }: { selected?: string[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-sm">
      {CAREER_PROFILES.map((profile) => (
        <label key={profile}>
          <input type="checkbox" name="profiles" value={profile} defaultChecked={selected.includes(profile)} /> {PROFILE_LABELS[profile]}
        </label>
      ))}
    </div>
  );
}
