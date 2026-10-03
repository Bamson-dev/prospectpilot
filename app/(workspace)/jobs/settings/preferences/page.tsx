import { saveApplicationSettings } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { applicationAutomationEnabled, applicationDailyTarget, applicationMode, jobDiscoveryEnabled } from "@/lib/applications/config";
import { ensureCandidate } from "@/lib/applications/service";
import { prisma } from "@/lib/db";

export const metadata = { title: "Job Search Preferences" };

export default async function JobPreferencesPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const candidate = await ensureCandidate(organization.id);
  const preference = await prisma.candidatePreference.findUnique({ where: { candidateId: candidate.id } });
  
  return (
    <div>
      <PageHeader title="Job Search Preferences" detail="Configure how the system discovers and targets jobs for you." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      
      <Panel className="mb-4">
        <h2 className="font-display text-xl mb-4">Discovery Engine</h2>
        <div className="grid gap-2 text-sm text-muted mb-4 bg-muted/10 p-3 rounded border border-line">
          <p>Environment mode: <strong className="text-ink">{applicationMode()}</strong></p>
          <p>Automation: <strong className="text-ink">{applicationAutomationEnabled() ? "ON" : "OFF"}</strong></p>
          <p>Discovery: <strong className="text-ink">{jobDiscoveryEnabled() ? "ON" : "OFF"}</strong></p>
          <p>Global daily target: <strong className="text-ink">{applicationDailyTarget()}</strong></p>
        </div>
        
        <form action={saveApplicationSettings} className="grid gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Application Mode</label>
            <select name="mode" defaultValue={preference?.mode ?? "AUTO_PREPARE"} className="w-full max-w-sm">
              <option value="MANUAL">Manual (Do everything myself)</option>
              <option value="AUTO_PREPARE">Auto Prepare (Prepare applications, then pause for review)</option>
              <option value="AUTO_SUBMIT">Auto Submit (Prepare and submit automatically)</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Daily Application Target</label>
            <input name="dailyTarget" type="number" min={1} max={500} defaultValue={preference?.dailyTarget ?? 500} className="w-full max-w-xs" />
            <p className="text-xs text-muted mt-1">Maximum number of applications to prepare/submit per day.</p>
          </div>
          
          <div className="flex items-center gap-2 mt-2">
            <input id="discoverJobs" name="discoverJobs" type="checkbox" defaultChecked={preference?.discoverJobs ?? false} className="w-4 h-4" />
            <label htmlFor="discoverJobs" className="text-sm">Allow this candidate to be included in automated job discovery runs</label>
          </div>

          <div className="mt-4 pt-4 border-t border-line">
            <SubmitButton pendingLabel="Saving...">Save Preferences</SubmitButton>
          </div>
        </form>
      </Panel>
    </div>
  );
}
