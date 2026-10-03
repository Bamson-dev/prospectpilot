import { saveCandidateProfile } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { ensureCandidate } from "@/lib/applications/service";
import { prisma } from "@/lib/db";

export const metadata = { title: "Standard Answers" };

export default async function CandidateAnswersPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const row = await ensureCandidate(organization.id);
  const candidate = await prisma.candidate.findFirst({
    where: { id: row.id, organizationId: organization.id },
    include: { facts: { where: { subcategory: "salary-expectation", source: "candidate-settings" } } }
  });
  if (!candidate) return null;
  const salaryExpectationFact = candidate.facts[0]?.fact.replace("Salary expectation: ", "") ?? "";

  const missing = (val: string | null | undefined) => !val || val.trim() === "";

  return (
    <div>
      <PageHeader title="Standard Answers" detail="Pre-answer common application questions to improve automated submission success rates." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />

      <Panel>
        <p className="mb-4 text-sm text-muted">
          Applications often require specific answers to standard compliance and availability questions. The automation uses these answers to fill out forms on your behalf.
        </p>

        <form action={saveCandidateProfile} className="grid gap-6">
          {/* We reuse the saveCandidateProfile action since these fields are natively on Candidate */}
          <input type="hidden" name="fullName" value={candidate.fullName} />
          <input type="hidden" name="email" value={candidate.email} />

          <div className="border border-line rounded p-4 relative">
            {missing(candidate.workAuthorization) && <span className="absolute top-2 right-2 bg-orange-100 text-orange-800 text-xs px-2 py-1 rounded font-medium">REQUIRES INPUT</span>}
            <label className="block font-medium mb-1">Work Authorization</label>
            <p className="text-sm text-muted mb-2">Are you legally authorized to work in the country you are applying in?</p>
            <input name="workAuthorization" defaultValue={candidate.workAuthorization ?? ""} placeholder="e.g. Yes, I am authorized to work in the US" className="w-full max-w-lg" />
          </div>

          <div className="border border-line rounded p-4 relative">
            {missing(candidate.sponsorship) && <span className="absolute top-2 right-2 bg-orange-100 text-orange-800 text-xs px-2 py-1 rounded font-medium">REQUIRES INPUT</span>}
            <label className="block font-medium mb-1">Sponsorship Requirement</label>
            <p className="text-sm text-muted mb-2">Will you now or in the future require sponsorship for employment visa status?</p>
            <input name="sponsorship" defaultValue={candidate.sponsorship ?? ""} placeholder="e.g. No, I do not require sponsorship" className="w-full max-w-lg" />
          </div>

          <div className="border border-line rounded p-4 relative">
            <label className="block font-medium mb-1">Salary Expectation</label>
            <p className="text-sm text-muted mb-2">What is your expected annual salary or hourly rate?</p>
            <input name="salaryExpectation" defaultValue={salaryExpectationFact} placeholder="e.g. $120,000/year" className="w-full max-w-lg" />
          </div>

          <div className="border border-line rounded p-4 relative">
            <label className="block font-medium mb-1">Notice Period</label>
            <p className="text-sm text-muted mb-2">How much notice do you need to give your current employer?</p>
            <input name="noticePeriod" defaultValue={candidate.noticePeriod ?? ""} placeholder="e.g. 2 weeks" className="w-full max-w-lg" />
          </div>

          <div className="border border-line rounded p-4 relative">
            <label className="block font-medium mb-1">Availability to Start</label>
            <p className="text-sm text-muted mb-2">When are you available to start working?</p>
            <input name="availability" defaultValue={candidate.availability ?? ""} placeholder="e.g. Immediately" className="w-full max-w-lg" />
          </div>

          <div>
            <SubmitButton pendingLabel="Saving...">Save Standard Answers</SubmitButton>
          </div>
        </form>
      </Panel>
    </div>
  );
}
