import Link from "next/link";
import { approveOutreach, rejectOutreach, skipOutreach, submitDraftForApproval } from "@/actions/outreach";
import { Empty, Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import type { OutreachState } from "@prisma/client";

const FILTERS: Array<{ id: string; label: string; states: OutreachState[] }> = [
  { id: "PENDING_APPROVAL", label: "Pending approval", states: ["PENDING_APPROVAL"] },
  { id: "DRAFT", label: "Drafts", states: ["DRAFT"] },
  { id: "APPROVED", label: "Approved", states: ["APPROVED", "SCHEDULED", "QUEUED", "SENDING"] },
  { id: "SENT", label: "Sent", states: ["SENT", "DELIVERED", "OPENED"] },
  { id: "FAILED", label: "Failed", states: ["FAILED"] },
  { id: "REPLIED", label: "Replies", states: ["REPLIED"] },
  { id: "CANCELLED", label: "Cancelled", states: ["CANCELLED", "SUPPRESSED"] },
];

export const metadata = { title: "Outreach" };

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; status?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const selected = FILTERS.find((item) => item.id === query.status) ?? FILTERS[0];
  const messages = await prisma.outreachMessage.findMany({
    where: { organizationId: organization.id, state: { in: selected.states } },
    orderBy: { updatedAt: "desc" },
    include: { prospect: true, contact: true, campaign: true },
    take: 40,
  });
  return (
    <div>
      <PageHeader title="Outreach" detail="A draft never sends by itself. Approval is a separate step, and a missing provider stops the worker." />
      <Flash error={query.error} notice={query.notice} />
      <nav className="mb-4 flex gap-3 overflow-x-auto text-sm">
        {FILTERS.map((item) => <Link key={item.id} className={item.id === selected.id ? "text-tide" : "text-muted"} href={`/outreach?status=${item.id}`}>{item.label}</Link>)}
      </nav>
      {messages.length === 0 ? <Empty title="Nothing in this view" detail="Save a draft from a prospect, then submit it for approval." /> : messages.map((message) => (
        <Panel key={message.id} className="mb-4">
          <p className="text-sm text-muted">{message.campaign?.name || "No campaign"} · {message.prospect.companyName} · {message.state} · {message.provider || "provider not chosen"}</p>
          <h2 className="font-display text-2xl">{message.contact?.email || "No recipient yet"}</h2>
          <p className="mt-1 text-sm">Sent {message.sentAt ? message.sentAt.toISOString().slice(0, 16).replace("T", " ") : "—"} · Delivered {message.deliveredAt ? "yes" : "no"}</p>
          {message.state === "PENDING_APPROVAL" ? (
            <form action={approveOutreach} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={message.id} />
              <input name="subject" defaultValue={message.subject} />
              <textarea name="body" rows={8} defaultValue={message.body} />
              <SubmitButton pendingLabel="Approving">Approve and queue</SubmitButton>
            </form>
          ) : message.state === "DRAFT" ? (
            <form action={submitDraftForApproval} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={message.id} />
              <input name="subject" defaultValue={message.subject} />
              <textarea name="body" rows={8} defaultValue={message.body} />
              <SubmitButton pendingLabel="Submitting">Submit for approval</SubmitButton>
            </form>
          ) : (
            <div className="mt-3 text-sm">
              <p className="font-medium">{message.subject}</p>
              <p className="mt-2 whitespace-pre-wrap text-muted">{message.body}</p>
            </div>
          )}
          {message.state === "PENDING_APPROVAL" ? (
            <div className="mt-2 flex gap-2">
              <form action={rejectOutreach}><input type="hidden" name="id" value={message.id} /><SubmitButton variant="secondary" pendingLabel="Rejecting">Reject</SubmitButton></form>
              <form action={skipOutreach}><input type="hidden" name="id" value={message.id} /><SubmitButton variant="secondary" pendingLabel="Skipping">Skip</SubmitButton></form>
            </div>
          ) : null}
        </Panel>
      ))}
    </div>
  );
}
