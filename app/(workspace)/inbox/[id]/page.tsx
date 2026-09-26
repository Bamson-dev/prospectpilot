import { notFound } from "next/navigation";
import { queueSuggestedReply } from "@/actions/outreach";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Conversation" };

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const { id } = await params;
  const query = await searchParams;
  const conversation = await prisma.conversation.findFirst({
    where: { id, organizationId: organization.id },
    include: {
      prospect: true,
      messages: { orderBy: { createdAt: "asc" } },
      replies: { orderBy: { receivedAt: "asc" } },
      notes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!conversation) notFound();
  return (
    <div>
      <PageHeader title={conversation.prospect.companyName} detail={conversation.subject} />
      <Flash error={query.error} notice={query.notice} />
      <div className="space-y-3">
        {conversation.messages.map((message) => (
          <Panel key={message.id}><p className="text-xs text-muted">Outreach · {message.state}</p><h2 className="font-display text-xl">{message.subject}</h2><pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{message.body}</pre></Panel>
        ))}
        {conversation.replies.map((reply) => (
          <Panel key={reply.id}>
            <p className="text-xs text-muted">Reply · {reply.classification}{reply.confidence != null ? ` · ${reply.confidence}` : ""}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{reply.body}</pre>
            {reply.suggestedBody ? (
              <form action={queueSuggestedReply} className="mt-3 space-y-2">
                <input type="hidden" name="replyId" value={reply.id} />
                <input name="subject" defaultValue={reply.suggestedSubject ?? ""} />
                <textarea name="body" rows={6} defaultValue={reply.suggestedBody} />
                <SubmitButton pendingLabel="Saving">Save suggestion for approval</SubmitButton>
              </form>
            ) : <p className="mt-2 text-sm text-muted">No suggested reply stored yet.</p>}
          </Panel>
        ))}
        {conversation.notes.map((note) => <Panel key={note.id}><p className="text-sm">{note.body}</p></Panel>)}
      </div>
    </div>
  );
}
