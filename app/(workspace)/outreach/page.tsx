import { approveOutreach, rejectOutreach, skipOutreach } from "@/actions/outreach";
import { Empty, Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Outreach" };

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const messages = await prisma.outreachMessage.findMany({
    where: { organizationId: organization.id, state: "PENDING_APPROVAL" },
    orderBy: { updatedAt: "desc" },
    include: { prospect: true, contact: true, campaign: true },
    take: 30,
  });
  return (
    <div>
      <PageHeader title="Outreach approval" detail="Nothing in this queue sends by itself. Approval puts the message on the worker queue." />
      <Flash error={query.error} notice={query.notice} />
      {messages.length === 0 ? <Empty title="No messages waiting" detail="A qualified prospect with a public email address appears here as a draft." /> : messages.map((message) => (
        <Panel key={message.id} className="mb-4">
          <p className="text-sm text-muted">{message.campaign?.name || "No campaign"} · {message.prospect.companyName}</p>
          <h2 className="font-display text-2xl">{message.contact?.email || "No email"}</h2>
          <p className="mt-2 text-sm">Why: {message.prospect.opportunityReason || "No qualification reason stored."}</p>
          <p className="mt-1 text-sm">Service: {message.prospect.recommendedService || "unknown"}</p>
          <form action={approveOutreach} className="mt-3 space-y-2">
            <input type="hidden" name="id" value={message.id} />
            <input name="subject" defaultValue={message.subject} />
            <textarea name="body" rows={8} defaultValue={message.body} />
            <div className="flex gap-2">
              <SubmitButton pendingLabel="Approving">Approve and queue</SubmitButton>
            </div>
          </form>
          <div className="mt-2 flex gap-2">
            <form action={rejectOutreach}><input type="hidden" name="id" value={message.id} /><SubmitButton variant="secondary" pendingLabel="Rejecting">Reject</SubmitButton></form>
            <form action={skipOutreach}><input type="hidden" name="id" value={message.id} /><SubmitButton variant="secondary" pendingLabel="Skipping">Skip</SubmitButton></form>
          </div>
        </Panel>
      ))}
    </div>
  );
}
