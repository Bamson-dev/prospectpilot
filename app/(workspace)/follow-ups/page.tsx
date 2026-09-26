import { approveFollowUp } from "@/actions/outreach";
import { Empty, Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Follow-ups" };

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
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
