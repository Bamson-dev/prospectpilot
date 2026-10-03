import { requireOrganization } from "@/lib/current-user";
import { evaluateSystemReadiness } from "@/lib/applications/system-readiness";
import { PageHeader, Panel } from "@/components/ui";

export default async function ActivationPage() {
  const { organization } = await requireOrganization();
  const readiness = await evaluateSystemReadiness(organization.id);

  // For this milestone, we do NOT actually wire up the button to `APPLICATION_LIVE_SUBMIT`.
  // We keep the gate closed and just record the UI intent if clicked.
  const isLive = process.env.APPLICATION_LIVE_SUBMIT === "true";

  return (
    <div className="max-w-3xl">
      <PageHeader title="System Activation" detail="Review the implications of activating live application submission." />

      {!readiness.readyToActivate && (
        <div className="mb-6 rounded-2xl border border-wine/20 bg-wine/5 p-4 flex items-start gap-3 text-wine">
          <div>
            <h3 className="font-semibold font-display">Activation Locked</h3>
            <p className="text-sm mt-1 text-wine/80">
              You must complete all required configuration in the System Readiness dashboard before you can activate the system.
            </p>
          </div>
        </div>
      )}

      <Panel className={isLive ? "border-tide" : ""}>
        <div className="mb-4 border-b border-line pb-4">
          <h2 className="text-xl font-display flex items-center gap-2">
            Live Application Submission
          </h2>
          <p className="text-sm text-muted mt-1">
            Activating this feature enables the autonomous worker to submit applications on your behalf.
          </p>
        </div>

        <div className="space-y-4 text-sm text-ink mb-6">
          <p>
            When you activate live submission, the following will occur:
          </p>
          <ul className="space-y-4 mt-4">
            <li className="flex items-start gap-3">
              <span className="text-tide">✓</span>
              <span><strong>Real applications will be submitted.</strong> ProspectPilot will begin transmitting your generated application packages to real employer applicant tracking systems.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-tide">✓</span>
              <span><strong>Candidate information will be used.</strong> The email, phone, location, and CV provided in your profile will be used directly in forms.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-tide">✓</span>
              <span><strong>Employer websites may require manual action.</strong> When the system encounters CAPTCHAs, Cloudflare checks, or unsupported forms, it will pause and prompt you to resolve the blocker in the Manual Action Center.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-tide">✓</span>
              <span><strong>Applications will be tracked.</strong> Applications that succeed will appear in your dashboard as &quot;Submitted&quot; or &quot;Verified&quot;.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-tide">✓</span>
              <span><strong>Live submission can be disabled again.</strong> You can return here to deactivate the system at any time, returning it to PREPARE_ONLY mode.</span>
            </li>
          </ul>
        </div>

        <div className="flex justify-between items-center border-t border-line pt-6 bg-panel-2 -mx-4 -mb-4 px-4 pb-4 rounded-b-2xl">
          <div className="text-sm text-muted">
            Current Environment Status: <span className={`font-mono font-bold ${isLive ? "text-tide" : "text-amber-500"}`}>{isLive ? "LIVE" : "DORMANT"}</span>
          </div>
          <button 
            disabled={!readiness.readyToActivate || isLive} 
            className="inline-flex h-9 items-center justify-center rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-paper hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLive ? "System Active" : "Activate Live Submission"}
          </button>
        </div>
      </Panel>
    </div>
  );
}
