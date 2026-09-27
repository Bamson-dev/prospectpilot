import Link from "next/link";
import { changePassword, saveWorkspaceSettings, updateOrganizationName, updateProfile } from "@/actions/settings";
import { addSuppression } from "@/actions/suppression";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { aiConfigured } from "@/lib/ai/service";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { discoverySourceCatalog } from "@/lib/discovery/status";
import { credentialStatus, integrationLabel } from "@/lib/integrations/status";

const SECTIONS = ["general", "profile", "organization", "email", "ai", "search", "outreach", "notifications", "security"] as const;

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ section?: string; error?: string; notice?: string }> }) {
  const { user, organization, membership } = await requireOrganization();
  const query = await searchParams;
  const section = SECTIONS.includes(query.section as (typeof SECTIONS)[number]) ? query.section : "general";
  const [settings, accounts, suppressions] = await Promise.all([
    prisma.setting.findMany({ where: { organizationId: organization.id } }),
    prisma.emailAccount.findMany({ where: { organizationId: organization.id }, select: { provider: true, status: true, fromEmail: true } }),
    prisma.suppression.findMany({ where: { organizationId: organization.id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const stored = Object.fromEntries(settings.map((item) => [item.key, item.value]));
  const flags = credentialStatus(accounts);
  const admin = membership.role !== "MEMBER";
  return (
    <div>
      <PageHeader title="Settings" detail="Limits and preferences are stored for this workspace. API secrets stay in the server environment." />
      <Flash error={query.error} notice={query.notice} />
      <nav className="mb-6 flex gap-3 overflow-x-auto text-sm">
        {SECTIONS.map((item) => <Link key={item} className={item === section ? "text-tide" : "text-muted"} href={`/settings?section=${item}`}>{item === "search" ? "discovery" : item}</Link>)}
      </nav>
      {section === "general" ? (
        <Panel>
          <p>{organization.name}</p>
          <p className="text-sm text-muted">{user.email} · {membership.role}</p>
          <div className="mt-3 flex gap-4 text-sm">
            <Link href="/billing">Billing</Link>
            {admin ? <Link href="/settings/jobs">Job monitor</Link> : null}
          </div>
        </Panel>
      ) : null}
      {section === "profile" ? (
        <form action={updateProfile} className="max-w-md space-y-2">
          <label className="text-sm text-muted">Name<input name="name" defaultValue={user.name} required /></label>
          <p className="text-sm text-muted">{user.email}</p>
          <SubmitButton pendingLabel="Saving">Save profile</SubmitButton>
        </form>
      ) : null}
      {section === "organization" ? (
        admin ? (
          <form action={updateOrganizationName} className="max-w-md space-y-2">
            <label className="text-sm text-muted">Organization<input name="name" defaultValue={organization.name} required /></label>
            <SubmitButton pendingLabel="Saving">Save organization</SubmitButton>
          </form>
        ) : <p className="text-sm text-muted">Only an owner or admin can rename the organization. You are in {organization.name}.</p>
      ) : null}
      {section === "email" || section === "outreach" || section === "notifications" || section === "search" || section === "ai" ? (
        <form action={saveWorkspaceSettings} className="max-w-xl space-y-3">
          <input type="hidden" name="section" value={section} />
          {section === "email" ? <p className="text-sm">Resend: {integrationLabel(flags.resend)}. Gmail: {integrationLabel(flags.gmail)}. Sender addresses are listed on Integrations. Keys are not shown.</p> : null}
          {section === "ai" ? <p className="text-sm">{aiConfigured() ? "DeepSeek is connected. The model name is configured on the server." : "AI integration not configured"}</p> : null}
          {section === "search" ? (
            <div className="space-y-2 text-sm">
              {discoverySourceCatalog().map((source) => (
                <p key={source.name}>{source.name}: {source.state}. {source.detail}</p>
              ))}
              <p className="text-muted">Google CSE stays disabled unless GOOGLE_CSE_ENABLED is exactly true. Brave is not required.</p>
            </div>
          ) : null}
          {admin ? (
            <>
              <label className="text-sm text-muted">Default daily discovery limit<input name="defaultDiscoveryLimit" defaultValue={stored.defaultDiscoveryLimit ?? "25"} /></label>
              <label className="text-sm text-muted">Default daily research limit<input name="defaultResearchLimit" defaultValue={stored.defaultResearchLimit ?? "25"} /></label>
              <label className="text-sm text-muted">Default daily outreach limit<input name="defaultOutreachLimit" defaultValue={stored.defaultOutreachLimit ?? "25"} /></label>
              <label className="text-sm text-muted">Default email provider
                <select name="defaultProvider" defaultValue={stored.defaultProvider ?? ""}>
                  <option value="">Choose later</option>
                  <option value="RESEND">Resend</option>
                  <option value="GMAIL">Gmail</option>
                </select>
              </label>
              <label className="text-sm text-muted">Approval required
                <select name="requireApproval" defaultValue={stored.requireApproval ?? "true"}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              <label className="text-sm text-muted">Follow-up days<input name="followUpDays" defaultValue={stored.followUpDays ?? "3, 7, 14"} /></label>
              <label className="text-sm text-muted">Notify on reply
                <select name="notifyOnReply" defaultValue={stored.notifyOnReply ?? "true"}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              <SubmitButton pendingLabel="Saving">Save settings</SubmitButton>
            </>
          ) : <p className="text-sm text-muted">Only an owner or admin can change workspace defaults.</p>}
        </form>
      ) : null}
      {section === "outreach" ? (
        <div className="mt-6 grid gap-4">
          <Panel>
            <h2 className="font-display text-2xl">Suppression</h2>
            <form action={addSuppression} className="mt-3 grid gap-2">
              <input name="email" type="email" placeholder="Email" required />
              <select name="reason" defaultValue="Manual suppression">
                {["Unsubscribe", "Do not contact", "Wrong person", "Manual suppression", "Provider complaint"].map((reason) => <option key={reason}>{reason}</option>)}
              </select>
              <textarea name="notes" rows={2} placeholder="Notes" />
              <SubmitButton pendingLabel="Saving">Suppress email</SubmitButton>
            </form>
          </Panel>
          {suppressions.length === 0 ? <p className="text-sm text-muted">No suppressed addresses.</p> : suppressions.map((item) => (
            <p key={item.id} className="text-sm">{item.email} · {item.reason} · {item.source} · {item.createdAt.toISOString().slice(0, 10)}</p>
          ))}
        </div>
      ) : null}
      {section === "security" ? (
        <form action={changePassword} className="max-w-md space-y-2">
          <p className="text-sm text-muted">Passwords are hashed. This form never displays the current password.</p>
          <label className="text-sm text-muted">Current password<input name="current" type="password" required /></label>
          <label className="text-sm text-muted">New password<input name="next" type="password" minLength={10} required /></label>
          <SubmitButton pendingLabel="Updating">Change password</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
