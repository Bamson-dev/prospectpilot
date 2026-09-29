import { addCandidateFact, saveCandidateDocument, saveCandidateProfile } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { missingCandidateFields, settingValue } from "@/lib/applications/candidate-fields";
import { evidenceLibrary } from "@/lib/applications/evidence-library";
import { applicationCriticalFields, availabilityLabel, candidateReadiness } from "@/lib/applications/readiness";
import { ensureCandidate } from "@/lib/applications/service";
import { prisma } from "@/lib/db";

export const metadata = { title: "Candidate" };

export default async function CandidatePage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const row = await ensureCandidate(organization.id);
  const candidate = await prisma.candidate.findFirst({
    where: { id: row.id, organizationId: organization.id },
    include: { profiles: true, experiences: true, projects: true, facts: true, writing: true, preference: true, education: true, certifications: true, baseDocuments: { select: { id: true, kind: true, fileName: true, createdAt: true }, orderBy: { createdAt: "desc" } } },
  });
  if (!candidate) return null;
  const readiness = candidateReadiness({
    email: candidate.email,
    phone: candidate.phone,
    location: candidate.location,
    linkedinUrl: candidate.linkedinUrl ?? settingValue(candidate.facts, "linkedin"),
    portfolioUrl: candidate.portfolioUrl,
    githubUrl: candidate.githubUrl,
    workAuthorization: candidate.workAuthorization ?? settingValue(candidate.facts, "work-authorization"),
    sponsorship: candidate.sponsorship,
    availability: candidate.availability,
    noticePeriod: candidate.noticePeriod ?? settingValue(candidate.facts, "notice-period"),
    institution: candidate.education[0]?.institution,
    degree: candidate.education[0]?.degree,
    certification: candidate.certifications[0]?.name,
      salaryExpectation: candidate.preference?.salaryCurrency && candidate.preference.salaryPeriod && (candidate.preference.salaryMin != null || candidate.preference.salaryTarget != null)
      ? `${candidate.preference.salaryMin ?? ""} ${candidate.preference.salaryCurrency}`
      : settingValue(candidate.facts, "salary-expectation"),
  });
  const critical = applicationCriticalFields({
    fullName: candidate.fullName,
    email: candidate.email,
    phone: candidate.phone,
    location: candidate.location,
    linkedinUrl: candidate.linkedinUrl ?? settingValue(candidate.facts, "linkedin"),
    workAuthorization: candidate.workAuthorization ?? settingValue(candidate.facts, "work-authorization"),
    sponsorship: candidate.sponsorship,
    salaryExpectation: settingValue(candidate.facts, "salary-expectation"),
    employmentStatus: settingValue(candidate.facts, "employment-status"),
    startDate: settingValue(candidate.facts, "start-date"),
    degree: candidate.education[0]?.degree,
    institution: candidate.education[0]?.institution,
    certification: candidate.certifications[0]?.name,
    verifiedExperience: candidate.facts.some((fact) => fact.verified && fact.sourceType !== "SYSTEM_GENERATED" && fact.category === "EXPERIENCE") || candidate.experiences.some((item) => item.verified),
    verifiedTechnology: candidate.facts.some((fact) => fact.verified && fact.sourceType !== "SYSTEM_GENERATED" && fact.category === "TECHNOLOGY") || candidate.projects.some((project) => project.verified && project.technologies.length > 0),
  });
  return (
    <div>
      <PageHeader title="Candidate" detail="Generated CVs use verified facts only. New facts need a source and are unverified until you mark them." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Personal information</h2>
        <form action={saveCandidateProfile} className="mt-3 grid gap-2">
          <h3 className="mt-2 text-sm text-muted">Identity</h3>
          <input name="fullName" defaultValue={candidate.fullName} placeholder="Full name" required />
          <input name="preferredName" defaultValue={settingValue(candidate.facts, "preferred-name")} placeholder="Preferred name, only if you want one stored" />
          <input name="email" type="email" defaultValue={candidate.email.endsWith("@invalid.test") ? "" : candidate.email} placeholder="Email" required />
          <input name="phone" defaultValue={candidate.phone ?? ""} placeholder="Phone" />
          <input name="location" defaultValue={candidate.location ?? ""} placeholder="Location" />
          <h3 className="mt-2 text-sm text-muted">Professional</h3>
          <input name="headline" defaultValue={candidate.headline ?? ""} placeholder="Professional headline" />
          <textarea name="summary" rows={3} defaultValue={settingValue(candidate.facts, "summary")} placeholder="Summary, only if you write one" />
          <input name="linkedin" defaultValue={candidate.linkedinUrl ?? settingValue(candidate.facts, "linkedin")} placeholder="LinkedIn URL" />
          <input name="portfolio" defaultValue={candidate.portfolioUrl ?? ""} placeholder="Portfolio URL" />
          <input name="website" defaultValue={settingValue(candidate.facts, "website")} placeholder="Website URL" />
          <input name="github" defaultValue={candidate.githubUrl ?? ""} placeholder="GitHub URL" />
          <h3 className="mt-2 text-sm text-muted">Employment</h3>
          <input name="currentRole" defaultValue={candidate.currentRole ?? ""} placeholder="Current role" />
          <input name="targetRoles" defaultValue={candidate.targetRoles.join(", ")} placeholder="Target roles, comma separated" />
          <input name="yearsExperience" defaultValue={candidate.yearsExperience ?? ""} placeholder="Years of experience, only if you know the number" />
          <h3 className="mt-2 text-sm text-muted">Work authorization</h3>
          <input name="workAuthorization" defaultValue={candidate.workAuthorization ?? settingValue(candidate.facts, "work-authorization")} placeholder="Work authorization" />
          <input name="sponsorship" defaultValue={candidate.sponsorship ?? ""} placeholder="Sponsorship requirement" />
          <h3 className="mt-2 text-sm text-muted">Compensation</h3>
          <input name="salaryMin" defaultValue={candidate.preference?.salaryMin ?? ""} placeholder="Minimum salary" />
          <input name="salaryTarget" defaultValue={candidate.preference?.salaryTarget ?? ""} placeholder="Desired salary" />
          <input name="salaryCurrency" defaultValue={candidate.preference?.salaryCurrency ?? ""} placeholder="Currency, for example USD" />
          <input name="salaryPeriod" defaultValue={candidate.preference?.salaryPeriod ?? ""} placeholder="Period: year, month, day, or hour" />
          <input name="negotiability" defaultValue={settingValue(candidate.facts, "negotiability")} placeholder="Negotiability, only if you want it stored" />
          <h3 className="mt-2 text-sm text-muted">Education and certifications</h3>
          <input name="institution" defaultValue={candidate.education[0]?.institution ?? ""} placeholder="Institution" />
          <input name="degree" defaultValue={candidate.education[0]?.degree ?? ""} placeholder="Degree" />
          <input name="field" defaultValue={candidate.education[0]?.field ?? ""} placeholder="Field of study" />
          <input name="educationStart" type="date" defaultValue={dateValue(candidate.education[0]?.startDate)} />
          <input name="educationEnd" type="date" defaultValue={dateValue(candidate.education[0]?.endDate)} />
          <input name="certification" defaultValue={candidate.certifications[0]?.name ?? ""} placeholder="Certification" />
          <input name="issuer" defaultValue={candidate.certifications[0]?.issuer ?? ""} placeholder="Certification issuer" />
          <input name="certificationDate" type="date" defaultValue={dateValue(candidate.certifications[0]?.issuedAt)} />
          <input name="credentialUrl" defaultValue={candidate.certifications[0]?.credentialUrl ?? ""} placeholder="Credential URL" />
          <h3 className="mt-2 text-sm text-muted">Skills and preferences</h3>
          <input name="skillProficiency" defaultValue={settingValue(candidate.facts, "proficiency")} placeholder="Skill proficiency, only if you supply it" />
          <input name="employmentStatus" defaultValue={settingValue(candidate.facts, "employment-status")} placeholder="Employment status, only if you want it stored" />
          <input name="startDate" defaultValue={settingValue(candidate.facts, "start-date")} placeholder="Start date, only if you want it stored" />
          <input name="availability" defaultValue={candidate.availability ?? ""} placeholder="Availability" />
          <input name="noticePeriod" defaultValue={candidate.noticePeriod ?? settingValue(candidate.facts, "notice-period")} placeholder="Notice period" />
          <input name="employmentPreference" defaultValue={candidate.employmentPreference ?? ""} placeholder="Employment type" />
          <input name="remotePreference" defaultValue={candidate.remotePreference ?? ""} placeholder="Remote preference" />
          <input name="relocationPreference" defaultValue={candidate.relocationPreference ?? ""} placeholder="Relocation preference" />
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
        <h2 className="font-display text-2xl">Application-critical fields</h2>
        <p className="mt-2 text-sm">AVAILABLE means you entered it. MISSING means it is blank. REVIEW REQUIRED means the saved value cannot be used. Nothing here is inferred.</p>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {critical.map((field) => <li key={field.label} className={field.state === "KNOWN" ? "" : "font-medium"}>{field.label}: {field.availability}. {field.note}</li>)}
        </ul>
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Readiness</h2>
        <p className="mt-2 text-sm">Profile {readiness.status}. CV {readiness.cvStatus}. Unknown values stay unknown.</p>
        {(["IDENTITY", "PROFESSIONAL", "EMPLOYMENT", "EDUCATION", "CERTIFICATIONS", "COMPENSATION"] as const).map((group) => (
          <div key={group} className="mt-3">
            <p className="text-sm text-muted">{group}</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {readiness.fields.filter((field) => field.group === group).map((field) => (
                <li key={field.field} className={field.state === "KNOWN" ? "" : "font-medium"}>{field.field}: {availabilityLabel(field.state)}. {purposeLabel(field.purpose)}. {field.note}</li>
              ))}
            </ul>
          </div>
        ))}
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Evidence library</h2>
        <p className="mt-2 text-sm text-muted">Only verified facts appear here. Generated CV text and cover-letter text are not evidence, and saving a document does not create a fact.</p>
        {evidenceLibrary({ facts: candidate.facts, projects: candidate.projects }).map((item) => (
          <p key={`${item.group}-${item.value}`} className="mt-2 text-sm">{item.group} · {item.value} · {item.origin} · {item.source} · {item.verification}{item.usableFor.length ? ` · ${item.usableFor.join(", ")}` : ""}</p>
        ))}
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Documents</h2>
        <p className="mt-2 text-sm text-muted">Base documents stay in this organization. Generated application files stay tied to a vacancy.</p>
        {candidate.baseDocuments.map((document) => <p key={document.id} className="mt-2 text-sm">{document.kind} · <a className="text-tide" href={`/api/jobs/candidate-documents/${document.id}`}>{document.fileName}</a></p>)}
        <form action={saveCandidateDocument} className="mt-3 grid gap-2">
          <select name="kind"><option value="BASE_CV">Base CV</option><option value="PORTFOLIO">Portfolio</option><option value="CERTIFICATE">Certificate</option><option value="OTHER">Other</option></select>
          <input name="file" type="file" required />
          <SubmitButton pendingLabel="Saving">Save document</SubmitButton>
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

function purposeLabel(purpose: "CV" | "APPLICATION" | "OPTIONAL") {
  if (purpose === "CV") return "Required for CV";
  if (purpose === "APPLICATION") return "Required when an employer asks";
  return "Optional";
}

function dateValue(value: Date | null | undefined) {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}
