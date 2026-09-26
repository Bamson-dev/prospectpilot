import { createCampaign } from "@/actions/campaigns";
import { Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "New campaign" };

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { organization } = await requireOrganization();
  const params = await searchParams;
  const accounts = await prisma.emailAccount.findMany({ where: { organizationId: organization.id, status: "ACTIVE" } });
  return (
    <div className="max-w-3xl">
      <PageHeader title="New campaign" detail="Discovery does not start until you explicitly start the campaign." />
      <Flash error={params.error} />
      <form action={createCampaign} className="grid gap-3 md:grid-cols-2">
        <Field label="Name" name="name" required />
        <Field label="Industry" name="industry" />
        <Field label="Country" name="country" />
        <Field label="City" name="city" />
        <label className="md:col-span-2 text-sm text-muted">Search terms<textarea name="searchTerms" required rows={3} placeholder="One term per line" /></label>
        <label className="md:col-span-2 text-sm text-muted">Description<textarea name="description" rows={3} /></label>
        <label className="text-sm text-muted">Opportunity
          <select name="opportunityFocus" defaultValue="SOFTWARE_AND_ADVERTISING">
            <option value="SOFTWARE">Software</option>
            <option value="ADVERTISING">Advertising</option>
            <option value="SOFTWARE_AND_ADVERTISING">Software and advertising</option>
            <option value="AUTOMATION">Automation</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <Field label="Target company size" name="targetCompanySize" />
        <Field label="Daily discovery limit" name="dailyDiscoveryLimit" type="number" defaultValue="25" />
        <Field label="Daily research limit" name="dailyResearchLimit" type="number" defaultValue="25" />
        <Field label="Daily outreach limit" name="dailyOutreachLimit" type="number" defaultValue="25" />
        <Field label="Follow-up days" name="followUps" defaultValue="3, 7, 14" />
        <label className="text-sm text-muted">Email provider
          <select name="provider" defaultValue="">
            <option value="">Choose later</option>
            <option value="RESEND">Resend</option>
            <option value="GMAIL">Gmail</option>
          </select>
        </label>
        <label className="text-sm text-muted">Sender
          <select name="emailAccountId" defaultValue="">
            <option value="">None saved yet</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.provider} · {account.fromEmail}</option>)}
          </select>
        </label>
        <div className="md:col-span-2"><SubmitButton pendingLabel="Saving">Save campaign</SubmitButton></div>
      </form>
    </div>
  );
}

function Field({ label, name, type = "text", required = false, defaultValue }: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string }) {
  return (
    <label className="text-sm text-muted">{label}
      <input name={name} type={type} required={required} defaultValue={defaultValue} />
    </label>
  );
}
