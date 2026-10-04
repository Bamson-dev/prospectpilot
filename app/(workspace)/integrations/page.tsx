import { saveResendSender } from "@/actions/outreach";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { credentialStatus, integrationLabel } from "@/lib/integrations/status";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization, membership } = await requireOrganization();
  const query = await searchParams;
  const accounts = await prisma.emailAccount.findMany({ where: { organizationId: organization.id }, orderBy: { createdAt: "desc" } });
  const status = credentialStatus(accounts.map((account) => ({ provider: account.provider, status: account.status })));
  const flags = [
    ["Google Search", integrationLabel(status.googleSearch)],
    ["DeepSeek", integrationLabel(status.deepseek)],
    ["Resend", integrationLabel(status.resend)],
    ["Gmail", integrationLabel(status.gmail)],
  ];
  return (
    <div>
      <PageHeader title="Integrations" detail="Status shows whether the server has a credential. Values are never displayed." />
      <Flash error={query?.error ? String(query.error) : undefined} notice={query?.notice ? String(query.notice) : undefined} />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {flags.map(([label, state]) => <Panel key={String(label)}><p>{String(label)}</p><p className="text-sm text-muted">Status: {String(state)}</p></Panel>)}
      </div>
      <Panel className="mb-4">
        <h2 className="font-display text-2xl">Saved senders</h2>
        {accounts.length === 0 ? <p className="mt-2 text-sm text-muted">No sender identity saved.</p> : accounts.map((account) => (
          <p key={account.id} className="mt-2 text-sm">{String(account.provider)} · {String(account.fromEmail)} · {String(account.status)}{account.lastError ? ` · ${String(account.lastError)}` : ""}</p>
        ))}
      </Panel>
      {membership.role === "MEMBER" ? <p className="text-sm text-muted">Only an owner or admin can add a sender.</p> : (
        <form action={saveResendSender} className="max-w-xl space-y-2">
          <label className="text-sm text-muted">Resend from email<input name="fromEmail" type="email" required /></label>
          <label className="text-sm text-muted">From name<input name="fromName" /></label>
          <SubmitButton pendingLabel="Saving">Save Resend sender</SubmitButton>
        </form>
      )}
      <p className="mt-4 text-sm"><a className="text-tide" href="/api/integrations/gmail/start">Connect Gmail</a></p>
      <p className="mt-2 text-sm text-muted">Discovery uses the configured search providers. Google Custom Search stays disabled unless it is explicitly enabled, and Gmail is separate from search.</p>
    </div>
  );
}
