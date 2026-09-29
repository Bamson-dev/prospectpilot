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
    include: { profiles: true, experiences: true, projects: true, facts: true, writing: true, preference: true, education: true, certifications: true },
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
          <input name="headline" defaultValue={candidate.headline ?? ""} placeholder="Headline" />
          <input name="linkedin" defaultValue={candidate.linkedinUrl ?? settingValue(candidate.facts, "linkedin")} placeholder="LinkedIn URL" />
          <input name="portfolio" defaultValue={candidate.portfolioUrl ?? ""} placeholder="Portfolio URL" />
          <input name="github" defaultValue={candidate.githubUrl ?? ""} placeholder="GitHub URL" />
          <input name="yearsExperience" defaultValue={candidate.yearsExperience ?? ""} placeholder="Years of experience" />
          <input name="currentRole" defaultValue={candidate.currentRole ?? ""} placeholder="Current role" />
          <input name="targetRoles" defaultValue={candidate.targetRoles.join(", ")} placeholder="Target roles, comma separated" />
          <input name="workAuthorization" defaultValue={candidate.workAuthorization ?? settingValue(candidate.facts, "work-authorization")} placeholder="Work authorization" />
          <input name="sponsorship" defaultValue={candidate.sponsorship ?? ""} placeholder="Sponsorship requirement" />
          <input name="availability" defaultValue={candidate.availability ?? ""} placeholder="Availability" />
          <input name="noticePeriod" defaultValue={candidate.noticePeriod ?? settingValue(candidate.facts, "notice-period")} placeholder="Notice period" />
          <input name="employmentPreference" defaultValue={candidate.employmentPreference ?? ""} placeholder="Employment preference" />
          <input name="remotePreference" defaultValue={candidate.remotePreference ?? ""} placeholder="Remote preference" />
          <input name="relocationPreference" defaultValue={candidate.relocationPreference ?? ""} placeholder="Relocation preference" />
          <input name="salaryMin" defaultValue={candidate.preference?.salaryMin ?? ""} placeholder="Minimum salary" />
          <input name="salaryTarget" defaultValue={candidate.preference?.salaryTarget ?? ""} placeholder="Target salary" />
          <input name="salaryCurrency" defaultValue={candidate.preference?.salaryCurrency ?? ""} placeholder="Currency, for example USD" />
          <input name="salaryPeriod" defaultValue={candidate.preference?.salaryPeriod ?? ""} placeholder="Period: year, month, day, or hour" />
          <input name="institution" defaultValue={candidate.education[0]?.institution ?? ""} placeholder="Education institution" />
          <input name="degree" defaultValue={candidate.education[0]?.degree ?? ""} placeholder="Degree" />
          <input name="field" defaultValue={candidate.education[0]?.field ?? ""} placeholder="Field of study" />
          <input name="educationStart" type="date" defaultValue={dateValue(candidate.education[0]?.startDate)} />
          <input name="educationEnd" type="date" defaultValue={dateValue(candidate.education[0]?.endDate)} />
          <input name="certification" defaultValue={candidate.certifications[0]?.name ?? ""} placeholder="Certification" />
          <input name="issuer" defaultValue={candidate.certifications[0]?.issuer ?? ""} placeholder="Certification issuer" />
          <input name="certificationDate" type="date" defaultValue={dateValue(candidate.certifications[0]?.issuedAt)} />
          <input name="credentialUrl" defaultValue={candidate.certifications[0]?.credentialUrl ?? ""} placeholder="Credential URL" />
          <p className="text-sm text-muted">Leave a field blank when you do not want it stored. Blank fields stay unknown. The number you type for a phone is stored as typed.</p>
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

function dateValue(value: Date | null | undefined) {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}
