import { addCandidateFact, saveCandidateProfile } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { missingCandidateFields, settingValue } from "@/lib/applications/candidate-fields";
import { ensureCandidate } from "@/lib/applications/service";
import { prisma } from "@/lib/db";

export const metadata = { title: "Candidate" };

export default async function CandidatePage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const row = await ensureCandidate(organization.id);
  const candidate = await prisma.candidate.findFirst({
    where: { id: row.id, organizationId: organization.id },
    include: { profiles: true, experiences: true, projects: true, facts: true, writing: true, preference: true },
  });
  if (!candidate) return null;
  return (
    <div>
      <PageHeader title="Candidate" detail="Generated CVs use verified facts only. New facts need a source and are unverified until you mark them." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Personal information</h2>
        <form action={saveCandidateProfile} className="mt-3 grid gap-2">
          <input name="fullName" defaultValue={candidate.fullName} required />
          <input name="email" type="email" defaultValue={candidate.email.endsWith("@invalid.test") ? "" : candidate.email} placeholder="Email" required />
          <input name="phone" defaultValue={candidate.phone ?? ""} placeholder="Phone" />
          <input name="location" defaultValue={candidate.location ?? ""} placeholder="Location" />
          <input name="linkedin" defaultValue={settingValue(candidate.facts, "linkedin")} placeholder="LinkedIn URL" />
          <input name="education" defaultValue={settingValue(candidate.facts, "education")} placeholder="Education" />
          <input name="certifications" defaultValue={settingValue(candidate.facts, "certifications")} placeholder="Certifications" />
          <input name="workAuthorization" defaultValue={settingValue(candidate.facts, "work-authorization")} placeholder="Work authorization" />
          <input name="noticePeriod" defaultValue={settingValue(candidate.facts, "notice-period")} placeholder="Notice period" />
          <input name="salaryExpectation" defaultValue={settingValue(candidate.facts, "salary-expectation")} placeholder="Salary expectation" />
          <p className="text-sm text-muted">Leave a field blank when you do not want it stored. Blank fields stay unknown.</p>
          <SubmitButton pendingLabel="Saving">Save profile</SubmitButton>
        </form>
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Career profiles</h2>
        {candidate.profiles.map((profile) => <p key={profile.id} className="mt-2 text-sm"><strong>{profile.title}</strong> · {profile.summary}</p>)}
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Experience and projects</h2>
        {candidate.experiences.map((item) => <p key={item.id} className="mt-2 text-sm">{item.title}, {item.organizationName}. {item.summary}</p>)}
        {candidate.projects.map((project) => <p key={project.id} className="mt-2 text-sm">{project.name} · {project.role} · {project.technologies.join(", ") || "No verified technologies"}</p>)}
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Facts</h2>
        {candidate.facts.map((fact) => <p key={fact.id} className="mt-2 text-sm">{fact.verified ? "Verified" : "Unverified"} · {fact.category} · {fact.fact} · {fact.source}</p>)}
        <form action={addCandidateFact} className="mt-3 grid gap-2">
          <select name="category"><option>EXPERIENCE</option><option>ACHIEVEMENT</option><option>SKILL</option><option>TECHNOLOGY</option><option>EDUCATION</option><option>CERTIFICATION</option><option>METRIC</option><option>PROJECT</option></select>
          <textarea name="fact" rows={3} placeholder="Verified fact" required />
          <input name="source" placeholder="Source" required />
          <label className="text-sm"><input name="verified" type="checkbox" /> Mark verified</label>
          <SubmitButton pendingLabel="Saving">Add fact</SubmitButton>
        </form>
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Not on file</h2>
        <p className="mt-2 text-sm">{missingCandidateFields(candidate).join(", ") || "None of the contact fields are blank."} Blank fields stay unknown. The system will not guess them.</p>
      </Panel>
      <Panel>
        <h2 className="font-display text-2xl">Writing style</h2>
        <p className="mt-2 text-sm">{candidate.writing?.tone} · {candidate.writing?.formality} · {candidate.writing?.verbosity}</p>
        <p className="mt-2 text-sm">{candidate.writing?.voice}</p>
      </Panel>
    </div>
  );
}
