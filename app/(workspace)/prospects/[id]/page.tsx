import { notFound } from "next/navigation";
import { queueResearch, updateProspectNotes } from "@/actions/prospects";
import { Flash, PageHeader, Panel, Pill } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Prospect" };

export default async function ProspectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const { id } = await params;
  const query = await searchParams;
  const prospect = await prisma.prospect.findFirst({
    where: { id, organizationId: organization.id },
    include: {
      contacts: { orderBy: { isPrimary: "desc" } },
      research: { orderBy: { createdAt: "desc" }, take: 3 },
      opportunities: { orderBy: { createdAt: "desc" } },
      messages: { orderBy: { createdAt: "desc" }, take: 5 },
      conversations: { include: { replies: true }, take: 3 },
      activity: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });
  if (!prospect) notFound();
  const signals = prospect.research[0]?.signals as { technology?: string[]; advertising?: string[] } | undefined;
  return (
    <div>
      <PageHeader title={prospect.companyName} detail={prospect.domain || "No domain stored"} />
      <Flash error={query.error} notice={query.notice} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Pill>{prospect.researchStatus}</Pill>
        <Pill>{prospect.qualificationStatus}</Pill>
        <Pill>{prospect.outreachState}</Pill>
        {prospect.opportunityScore != null ? <Pill>Score {prospect.opportunityScore}</Pill> : null}
      </div>
      <form action={queueResearch} className="mb-6"><input type="hidden" name="id" value={prospect.id} /><SubmitButton pendingLabel="Queuing">Queue research</SubmitButton></form>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="font-display text-2xl">Company</h2>
          <p className="mt-2 text-sm">{prospect.website ? <a href={prospect.website}>{prospect.website}</a> : "No website stored."}</p>
          <p className="mt-2 text-sm text-muted">{prospect.description || "No description stored."}</p>
          <p className="mt-2 text-sm">Source: {prospect.source}{prospect.sourceUrl ? ` · ${prospect.sourceUrl}` : ""}</p>
        </Panel>
        <Panel>
          <h2 className="font-display text-2xl">Contacts</h2>
          {prospect.contacts.length === 0 ? <p className="mt-2 text-sm text-muted">No public contact has been stored. Names are not guessed.</p> : prospect.contacts.map((contact) => (
            <p key={contact.id} className="mt-2 text-sm">{contact.fullName || "Name unknown"} · {contact.jobTitle || "Title unknown"} · {contact.email || "No email"} · confidence {contact.confidence} · {contact.sourceUrl || contact.source}</p>
          ))}
        </Panel>
        <Panel>
          <h2 className="font-display text-2xl">Research</h2>
          {prospect.research.length === 0 ? <p className="mt-2 text-sm text-muted">No research record yet.</p> : prospect.research.map((record) => (
            <div key={record.id} className="mt-3 text-sm">
              <p>{record.fetchMethod} · <a href={record.url}>{record.title || record.url}</a></p>
              <p className="text-muted">{record.excerpt?.slice(0, 360)}</p>
            </div>
          ))}
        </Panel>
        <Panel>
          <h2 className="font-display text-2xl">Signals</h2>
          <p className="mt-2 text-sm">Technology: {signals?.technology?.join(", ") || "None observed"}</p>
          <p className="mt-2 text-sm">Advertising: {signals?.advertising?.join(", ") || "None observed"}</p>
          <p className="mt-2 text-sm">Software score: {prospect.softwareOpportunity ?? "unknown"}</p>
          <p className="text-sm">Advertising score: {prospect.advertisingOpportunity ?? "unknown"}</p>
          <p className="text-sm">Automation score: {prospect.automationOpportunity ?? "unknown"}</p>
        </Panel>
        <Panel>
          <h2 className="font-display text-2xl">Qualification</h2>
          <p className="mt-2 text-sm">{prospect.researchSummary || "Not qualified yet."}</p>
          <p className="mt-2 text-sm text-muted">{prospect.opportunityReason}</p>
          <p className="mt-2 text-sm">Recommended service: {prospect.recommendedService || "unknown"}</p>
          {prospect.opportunities.map((item) => (
            <p key={item.id} className="mt-2 text-sm">{item.kind} · confidence {item.confidence} · {item.interpretation}</p>
          ))}
        </Panel>
        <Panel>
          <h2 className="font-display text-2xl">Outreach and conversation</h2>
          {prospect.messages.length === 0 ? <p className="mt-2 text-sm text-muted">No message drafted.</p> : prospect.messages.map((message) => (
            <p key={message.id} className="mt-2 text-sm">{message.state} · {message.subject}</p>
          ))}
          <p className="mt-3 text-sm">Replies: {prospect.conversations.reduce((sum, conversation) => sum + conversation.replies.length, 0)}</p>
        </Panel>
      </div>
      <form action={updateProspectNotes} className="mt-4 max-w-3xl space-y-2">
        <input type="hidden" name="id" value={prospect.id} />
        <label className="text-sm text-muted">Notes<textarea name="notes" rows={4} defaultValue={prospect.description ?? ""} /></label>
        <SubmitButton variant="secondary" pendingLabel="Saving">Save notes</SubmitButton>
      </form>
      <Panel className="mt-4">
        <h2 className="font-display text-2xl">Activity</h2>
        {prospect.activity.map((entry) => <p key={entry.id} className="mt-2 text-sm">{entry.action}{entry.detail ? ` · ${entry.detail}` : ""}</p>)}
      </Panel>
    </div>
  );
}
