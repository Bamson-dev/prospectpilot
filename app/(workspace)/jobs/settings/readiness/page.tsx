import { requireOrganization } from "@/lib/current-user";
import { evaluateSystemReadiness, ReadinessItem } from "@/lib/applications/system-readiness";
import { PageHeader, Panel, Pill } from "@/components/ui";
import Link from "next/link";

export default async function ReadinessPage() {
  const { organization } = await requireOrganization();
  const readiness = await evaluateSystemReadiness(organization.id);

  return (
    <div>
      <PageHeader title="System Readiness" detail="Configure ProspectPilot before activating live application submission." />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <div className="col-span-1 lg:col-span-2 flex flex-col gap-6">
          <SectionCard title="Account Requirements" status={readiness.account.status} items={readiness.account.items} />
          <SectionCard title="Career Profile" status={readiness.career.status} items={readiness.career.items} />
          <SectionCard title="Job Preferences" status={readiness.preferences.status} items={readiness.preferences.items} />
        </div>

        <div className="col-span-1 flex flex-col gap-6">
          <Panel>
            <h2 className="text-xl font-display mb-4">System Components</h2>
            <div className="flex flex-col gap-4 text-sm">
              <SystemRow label="Discovery" status={readiness.subsystems.discovery} />
              <SystemRow label="Qualification" status={readiness.subsystems.qualification} />
              <SystemRow label="Candidate" status={readiness.subsystems.candidate} />
              <SystemRow label="Document Generation" status={readiness.subsystems.documentGeneration} />
              <SystemRow label="Application Preparation" status={readiness.subsystems.applicationPreparation} />
              <SystemRow label="Browser Automation" status={readiness.subsystems.browserAutomation} />
              <SystemRow label="Submission Engine" status={readiness.subsystems.submissionEngine} />
              <SystemRow label="Gmail Integration" status={readiness.subsystems.gmail} />
              <SystemRow label="Outbound Email" status={readiness.subsystems.outboundEmail} />
              <SystemRow label="Live Submission" status={readiness.subsystems.liveApplicationSubmission} />
            </div>
          </Panel>

          <Panel className={readiness.readyToActivate ? "border-[#24523a] bg-[#122018]" : ""}>
            <h2 className="text-xl font-display mb-2">Activation</h2>
            <p className="text-sm text-muted mb-4">
              {readiness.readyToActivate 
                ? "The system is PRE-ACTIVATION READY." 
                : "Complete required steps to unlock activation."}
            </p>
            {readiness.readyToActivate ? (
              <Link href="/jobs/settings/activation" className="inline-block text-tide underline-offset-2 hover:underline">
                Proceed to Activation &rarr;
              </Link>
            ) : (
              <p className="text-muted text-sm italic">
                Activation is locked until all required configuration is complete.
              </p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, status, items }: { title: string, status: string, items: ReadinessItem[] }) {
  return (
    <Panel>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-display">{title}</h2>
        <Pill>{status}</Pill>
      </div>
      <div className="flex flex-col gap-4">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between border-b border-line pb-4 last:border-0 last:pb-0">
            <div className="flex items-center gap-3">
              <span className={`text-sm ${item.status === "READY" ? "text-tide" : item.type === "REQUIRED" ? "text-wine" : "text-amber-500"}`}>
                {item.status === "READY" ? "✓" : "!"}
              </span>
              <span className="text-sm font-medium">{item.name}</span>
              <Pill>{item.type}</Pill>
            </div>
            <Link href={item.link} className="text-sm text-muted hover:text-ink underline-offset-2 hover:underline">
              {item.status === "READY" ? "Edit" : "Configure"}
            </Link>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SystemRow({ label, status }: { label: string, status: string }) {
  const isReady = status === "READY" || status === "CONNECTED";
  const isDanger = status === "DISABLED" || status === "NOT_READY";
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={`font-medium ${isReady ? "text-tide" : isDanger ? "text-wine" : "text-ink"}`}>
        {status}
      </span>
    </div>
  );
}
