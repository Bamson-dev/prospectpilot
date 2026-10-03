import { saveCandidateProfile } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { ensureCandidate } from "@/lib/applications/service";
import { settingValue } from "@/lib/applications/candidate-fields";
import { prisma } from "@/lib/db";

export const metadata = { title: "Candidate Profile" };

export default async function CandidatePage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const row = await ensureCandidate(organization.id);
  const candidate = await prisma.candidate.findFirst({
    where: { id: row.id, organizationId: organization.id },
    include: { facts: true, projects: true, experiences: true },
  });
  if (!candidate) return null;

  return (
    <div>
      <PageHeader title="Candidate Profile" detail="Configure your application identity to be used across all platforms." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      
      <form action={saveCandidateProfile} className="flex flex-col gap-6">
        <Panel>
          <h2 className="font-display text-xl mb-4">Identity</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted mb-1">Full Name</label>
              <input name="fullName" defaultValue={candidate.fullName} className="w-full" required />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Email</label>
              <input name="email" type="email" defaultValue={candidate.email.endsWith("@invalid.test") ? "" : candidate.email} className="w-full" required />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Phone</label>
              <input name="phone" defaultValue={candidate.phone ?? ""} className="w-full" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Location (City, State)</label>
              <input name="location" defaultValue={candidate.location ?? ""} className="w-full" />
            </div>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-xl mb-4">Career Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted mb-1">Current/Target Title</label>
              <input name="currentRole" defaultValue={candidate.currentRole ?? ""} className="w-full" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Target Roles (comma separated)</label>
              <input name="targetRoles" defaultValue={candidate.targetRoles.join(", ")} className="w-full" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Years of Experience</label>
              <input name="yearsExperience" type="number" defaultValue={candidate.yearsExperience ?? ""} className="w-full" />
            </div>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-xl mb-4">Application Parameters</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted mb-1">Work Authorization</label>
              <input name="workAuthorization" defaultValue={candidate.workAuthorization ?? ""} placeholder="e.g. Authorized to work in the US" className="w-full" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Sponsorship Requirement</label>
              <input name="sponsorship" defaultValue={candidate.sponsorship ?? ""} placeholder="e.g. Do not require sponsorship" className="w-full" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Notice Period</label>
              <input name="noticePeriod" defaultValue={candidate.noticePeriod ?? ""} placeholder="e.g. 2 weeks" className="w-full" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Availability</label>
              <input name="availability" defaultValue={candidate.availability ?? ""} placeholder="e.g. Immediately" className="w-full" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Employment Preference</label>
              <input name="employmentPreference" defaultValue={candidate.employmentPreference ?? ""} placeholder="e.g. Full-time" className="w-full" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Remote Preference</label>
              <input name="remotePreference" defaultValue={candidate.remotePreference ?? ""} placeholder="e.g. Remote or Hybrid" className="w-full" />
            </div>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-xl mb-4">Online Presence</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted mb-1">LinkedIn URL</label>
              <input name="linkedin" defaultValue={candidate.linkedinUrl ?? ""} className="w-full" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Portfolio URL</label>
              <input name="portfolio" defaultValue={candidate.portfolioUrl ?? ""} className="w-full" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">GitHub URL</label>
              <input name="github" defaultValue={candidate.githubUrl ?? ""} className="w-full" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Personal Website URL</label>
              <input name="website" defaultValue={settingValue(candidate.facts, "website")} className="w-full" />
            </div>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-xl mb-4">Evidence by Career Lane</h2>
          <div className="space-y-6">
            {(["SOFTWARE", "MARKETING", "HYBRID"] as import("@prisma/client").CareerProfileKind[]).map(lane => {
              const laneProjects = candidate.projects.filter(p => p.profiles.includes(lane));
              const laneExp = candidate.experiences.filter(e => e.profiles.includes(lane));
              
              if (laneProjects.length === 0 && laneExp.length === 0) return null;

              return (
                <div key={lane} className="border rounded p-4">
                  <h3 className="font-bold mb-2">{lane}</h3>
                  
                  {laneExp.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-sm text-muted font-semibold mb-1">Experiences</h4>
                      <ul className="list-disc pl-5 text-sm space-y-1">
                        {laneExp.map(exp => (
                          <li key={exp.id}>{exp.title} at {exp.organizationName}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {laneProjects.length > 0 && (
                    <div>
                      <h4 className="text-sm text-muted font-semibold mb-1">Projects</h4>
                      <ul className="list-disc pl-5 text-sm space-y-1">
                        {laneProjects.map(proj => (
                          <li key={proj.id}>{proj.name} ({proj.role})</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        <div>
          <SubmitButton pendingLabel="Saving...">Save Profile</SubmitButton>
        </div>
      </form>
    </div>
  );
}
