import Link from "next/link";
import { syncInbox } from "@/actions/outreach";
import { Empty, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const conversations = await prisma.conversation.findMany({
    where: { organizationId: organization.id },
    orderBy: { updatedAt: "desc" },
    include: { prospect: true, replies: { orderBy: { receivedAt: "desc" }, take: 1 }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    take: 50,
  });
  return (
    <div>
      <PageHeader title="Inbox" detail="Conversations are created from outreach and from synced replies. Gmail sync is manual until a connected account exists." />
      <Flash error={query.error} notice={query.notice} />
      <form action={syncInbox} className="mb-4"><SubmitButton pendingLabel="Queuing">Sync Gmail</SubmitButton></form>
      {conversations.length === 0 ? <Empty title="No conversations" detail="Approving outreach creates the first thread. Replies are added by Gmail sync or the Resend webhook." /> : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table>
            <thead><tr><th>Company</th><th>Subject</th><th>Latest</th><th>Classification</th></tr></thead>
            <tbody>
              {conversations.map((conversation) => (
                <tr key={conversation.id}>
                  <td><Link href={`/inbox/${conversation.id}`}>{conversation.prospect.companyName}</Link></td>
                  <td>{conversation.subject}</td>
                  <td>{conversation.replies[0]?.body.slice(0, 80) || conversation.messages[0]?.state || "—"}</td>
                  <td>{conversation.replies[0]?.classification || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
