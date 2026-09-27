import { notFound } from "next/navigation";
import { archiveCampaign, pauseCampaign, resumeCampaign, startCampaign } from "@/actions/campaigns";
import { Flash, PageHeader, Panel, Pill } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { campaignOverview } from "@/lib/campaign-stats";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { buildDiscoveryQueries } from "@/lib/search/queries";

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
  const failedJobs = await prisma.backgroundJob.findMany({
    where: { campaignId: campaign.id, organizationId: organization.id, state: "FAILED" },
    orderBy: { finishedAt: "desc" },
    take: 3,
  });
  const stats = await campaignOverview(organization.id, campaign.id);
  const queries = buildDiscoveryQueries(campaign);
  const counts = [
    ["Prospects", stats.prospects],
    ["Researched", stats.researched],
    ["Qualified", stats.qualified],
    ["Approved", stats.approved],
    ["Sent", stats.sent],
    ["Replies", stats.replies],
    ["Interested", stats.interested],
    ["Meetings", stats.meetings],
  ] as const;
  return (
    <div>
      <PageHeader title={campaign.name} detail={campaign.description || campaign.searchTerms} />
      <Flash error={query.error ?? failedJobs[0]?.error ?? undefined} notice={query.notice} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Pill>{campaign.status}</Pill>
        <Pill>{campaign.opportunityFocus}</Pill>
        <Pill>{campaign.dailyDiscoveryLimit}/day discovery</Pill>
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {counts.map(([label, value]) => <Panel key={label}><p className="text-xs uppercase tracking-wider text-muted">{label}</p><p className="mt-2 font-display text-3xl">{value}</p></Panel>)}
      </div>
      <Panel className="mb-6">
        <h2 className="font-display text-2xl">Search queries</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {queries.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </Panel>
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
