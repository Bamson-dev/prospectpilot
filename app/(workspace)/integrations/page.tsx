import { saveResendSender } from "@/actions/outreach";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization, membership } = await requireOrganization();
  const query = await searchParams;
  const accounts = await prisma.emailAccount.findMany({ where: { organizationId: organization.id }, orderBy: { createdAt: "desc" } });
  const flags = [
    ["DeepSeek", Boolean(process.env.DEEPSEEK_API_KEY)],
    ["Resend", Boolean(process.env.RESEND_API_KEY)],
    ["Gmail OAuth", Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REDIRECT_URI)],
    ["Google Custom Search", Boolean(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX)],
    ["Redis", Boolean(process.env.REDIS_URL)],
  ];
  return (
    <div>
      <PageHeader title="Integrations" detail="Status shows whether the server has a credential. Values are never displayed." />
      <Flash error={query.error} notice={query.notice} />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {flags.map(([label, enabled]) => <Panel key={String(label)}><p>{label}</p><p className="text-sm text-muted">{enabled ? "Configured" : "Not configured"}</p></Panel>)}
      </div>
      <Panel className="mb-4">
        <h2 className="font-display text-2xl">Saved senders</h2>
        {accounts.length === 0 ? <p className="mt-2 text-sm text-muted">No sender identity saved.</p> : accounts.map((account) => (
          <p key={account.id} className="mt-2 text-sm">{account.provider} · {account.fromEmail} · {account.status}{account.lastError ? ` · ${account.lastError}` : ""}</p>
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
      <p className="mt-2 text-sm text-muted">Without a Custom Search key, discovery uses Google’s public HTML results at a fixed slow rate and stops if Google blocks it.</p>
    </div>
  );
}
