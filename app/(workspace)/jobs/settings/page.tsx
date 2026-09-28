import { saveApplicationSettings } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { applicationAutomationEnabled, applicationDailyTarget, applicationMode, jobDiscoveryEnabled } from "@/lib/applications/config";
import { ensureCandidate } from "@/lib/applications/service";
import { prisma } from "@/lib/db";

export const metadata = { title: "Application settings" };

export default async function JobSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const candidate = await ensureCandidate(organization.id);
  const preference = await prisma.candidatePreference.findUnique({ where: { candidateId: candidate.id } });
  return (
    <div>
      <PageHeader title="Application settings" detail="Automatic submission is a deployment switch. Saving a preference here does not turn it on." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      <Panel className="mb-3">
        <p className="text-sm">Environment mode {applicationMode()}. Automation {applicationAutomationEnabled() ? "on" : "off"}. Discovery {jobDiscoveryEnabled() ? "on" : "off"}. Target {applicationDailyTarget()}.</p>
        <p className="mt-2 text-sm text-muted">Sales outreach remains a separate system and stays on its own send switch.</p>
      </Panel>
      <Panel>
        <form action={saveApplicationSettings} className="grid gap-2">
          <select name="mode" defaultValue={preference?.mode ?? "AUTO_PREPARE"}>
            <option value="MANUAL">Manual</option>
            <option value="AUTO_PREPARE">Prepare, then pause</option>
            <option value="AUTO_SUBMIT">Submit when the deployment allows it</option>
          </select>
          <input name="dailyTarget" type="number" min={1} max={500} defaultValue={preference?.dailyTarget ?? 500} />
          <label className="text-sm"><input name="discoverJobs" type="checkbox" defaultChecked={preference?.discoverJobs ?? false} /> Allow this candidate to be included in discovery</label>
          <SubmitButton pendingLabel="Saving">Save settings</SubmitButton>
        </form>
      </Panel>
    </div>
  );
}
