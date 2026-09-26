import { saveSequence } from "@/actions/campaigns";
import { approveFollowUp } from "@/actions/outreach";
import { Empty, Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Follow-ups" };

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const [campaigns, sequences] = await Promise.all([
    prisma.campaign.findMany({ where: { organizationId: organization.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.sequence.findMany({ where: { organizationId: organization.id }, include: { steps: { orderBy: { position: "asc" } }, campaign: true }, take: 20 }),
  ]);
  const items = await prisma.followUp.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { campaign: true },
  });
  return (
    <div>
      <PageHeader title="Follow-ups" detail="Follow-ups wait for approval unless a campaign explicitly allows automatic scheduling. Replies, suppression, and pauses cancel them." />
      <Flash error={query.error} notice={query.notice} />
      <Panel className="mb-4">
        <h2 className="font-display text-2xl">Sequence</h2>
        <p className="mt-2 text-sm text-muted">Day 0 is the approved email. Later steps stay unsent until a provider is configured and a person approves them.</p>
        {campaigns.length === 0 ? <p className="mt-3 text-sm text-muted">Create a campaign before saving a sequence.</p> : (
          <form action={saveSequence} className="mt-3 grid gap-2 md:grid-cols-3">
            <select name="campaignId" required>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>
            <input name="name" placeholder="Sequence name" defaultValue="Default follow-up" />
            <input name="days" defaultValue="3, 7, 14" />
            <SubmitButton pendingLabel="Saving">Save sequence</SubmitButton>
          </form>
        )}
        {sequences.map((sequence) => (
          <p key={sequence.id} className="mt-3 text-sm">{sequence.campaign.name} · {sequence.name} · {sequence.steps.map((step) => `day ${step.dayOffset}`).join(", ")}</p>
        ))}
      </Panel>
      {items.length === 0 ? <Empty title="No follow-ups" detail="They are created after an approved message is sent." /> : items.map((item) => (
        <Panel key={item.id} className="mb-3">
          <p className="text-sm text-muted">{item.campaign.name} · day {item.dayOffset} · {item.state}</p>
          {item.state === "PENDING_APPROVAL" ? (
            <form action={approveFollowUp} className="mt-2 space-y-2">
              <input type="hidden" name="id" value={item.id} />
              <input name="subject" defaultValue={item.subject} />
              <textarea name="body" rows={5} defaultValue={item.body} />
              <SubmitButton pendingLabel="Scheduling">Approve schedule</SubmitButton>
            </form>
          ) : <p className="mt-2 text-sm">{item.subject}</p>}
        </Panel>
      ))}
    </div>
  );
}
