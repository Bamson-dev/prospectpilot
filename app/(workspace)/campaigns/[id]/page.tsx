import { notFound } from "next/navigation";
import { archiveCampaign, pauseCampaign, resumeCampaign, startCampaign } from "@/actions/campaigns";
import { Flash, PageHeader, Panel, Pill } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const { id } = await params;
  const query = await searchParams;
  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: organization.id },
    include: { activity: { orderBy: { createdAt: "desc" }, take: 12 }, prospects: { orderBy: { createdAt: "desc" }, take: 8 } },
  });
  if (!campaign) notFound();
  return (
    <div>
      <PageHeader title={campaign.name} detail={campaign.description || campaign.searchTerms} />
      <Flash error={query.error} notice={query.notice} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Pill>{campaign.status}</Pill>
        <Pill>{campaign.opportunityFocus}</Pill>
        <Pill>{campaign.dailyDiscoveryLimit}/day discovery</Pill>
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        <form action={startCampaign}><input type="hidden" name="id" value={campaign.id} /><SubmitButton pendingLabel="Starting">Start discovery</SubmitButton></form>
        <form action={pauseCampaign}><input type="hidden" name="id" value={campaign.id} /><SubmitButton variant="secondary" pendingLabel="Pausing">Pause</SubmitButton></form>
        <form action={resumeCampaign}><input type="hidden" name="id" value={campaign.id} /><SubmitButton variant="secondary" pendingLabel="Resuming">Resume</SubmitButton></form>
        <form action={archiveCampaign}><input type="hidden" name="id" value={campaign.id} /><SubmitButton variant="secondary" pendingLabel="Archiving">Archive</SubmitButton></form>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="font-display text-2xl">Latest prospects</h2>
          {campaign.prospects.length === 0 ? <p className="mt-3 text-sm text-muted">No companies stored for this campaign yet.</p> : campaign.prospects.map((prospect) => (
            <p key={prospect.id} className="border-b border-line py-2 text-sm"><a href={`/prospects/${prospect.id}`}>{prospect.companyName}</a></p>
          ))}
        </Panel>
        <Panel>
          <h2 className="font-display text-2xl">Activity</h2>
          {campaign.activity.length === 0 ? <p className="mt-3 text-sm text-muted">No activity yet.</p> : campaign.activity.map((entry) => (
            <p key={entry.id} className="border-b border-line py-2 text-sm">{entry.action}{entry.detail ? ` · ${entry.detail}` : ""}</p>
          ))}
        </Panel>
      </div>
    </div>
  );
}
