import Link from "next/link";
import { notFound } from "next/navigation";
import { createContact, deleteContact, setPrimaryContact } from "@/actions/contacts";
import { addOpportunity } from "@/actions/opportunities";
import { saveOutreachDraft } from "@/actions/outreach";
import { deleteProspect, queueResearch, updateProspect, updateProspectNotes } from "@/actions/prospects";
import { Flash, PageHeader, Panel, Pill } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { aiConfigured } from "@/lib/ai/service";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

const SECTIONS = ["overview", "research", "opportunity", "contacts", "outreach", "conversation", "activity"] as const;
type Section = (typeof SECTIONS)[number];

export const metadata = { title: "Prospect" };

export default async function ProspectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string; section?: string }> }) {
  const { organization } = await requireOrganization();
  const { id } = await params;
  const query = await searchParams;
  const section: Section = SECTIONS.includes(query.section as Section) ? (query.section as Section) : "overview";
  const prospect = await prisma.prospect.findFirst({
    where: { id, organizationId: organization.id },
    include: {
      contacts: { orderBy: { isPrimary: "desc" } },
      research: { orderBy: { createdAt: "desc" }, take: 5 },
      opportunities: { orderBy: { createdAt: "desc" } },
      messages: { orderBy: { createdAt: "desc" }, take: 12 },
      conversations: { include: { replies: { orderBy: { receivedAt: "asc" } }, messages: { orderBy: { createdAt: "asc" } } }, take: 5 },
      activity: { orderBy: { createdAt: "desc" }, take: 30 },
      tags: { include: { tag: true } },
    },
  });
  if (!prospect) notFound();
  return (
    <div>
      <PageHeader title={prospect.companyName} detail={prospect.domain || "No domain stored"} />
      <Flash error={query.error} notice={query.notice} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Pill>{prospect.researchStatus}</Pill>
        <Pill>{prospect.qualificationStatus}</Pill>
        <Pill>{prospect.outreachState}</Pill>
        {prospect.tags.map((item) => <Pill key={item.tagId}>{item.tag.name}</Pill>)}
      </div>
      <nav className="mb-6 flex gap-2 overflow-x-auto text-sm">
        {SECTIONS.map((item) => (
          <Link key={item} className={item === section ? "text-tide" : "text-muted"} href={`/prospects/${prospect.id}?section=${item}`}>{item}</Link>
        ))}
      </nav>
      {section === "overview" ? <Overview prospect={prospect} /> : null}
      {section === "research" ? <Research prospect={prospect} /> : null}
      {section === "opportunity" ? <Opportunity prospect={prospect} ai={aiConfigured()} /> : null}
      {section === "contacts" ? <Contacts prospect={prospect} /> : null}
      {section === "outreach" ? <Outreach prospect={prospect} /> : null}
      {section === "conversation" ? <Conversation prospect={prospect} /> : null}
      {section === "activity" ? <Activity prospect={prospect} /> : null}
    </div>
  );
}

function Overview({ prospect }: { prospect: ProspectView }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel>
        <h2 className="font-display text-2xl">Company</h2>
        <p className="mt-2 text-sm">{prospect.website ? <a href={prospect.website}>{prospect.website}</a> : "No website stored."}</p>
        <p className="mt-2 text-sm text-muted">{[prospect.city, prospect.country].filter(Boolean).join(", ") || "Location unknown"} · {prospect.industry || "Industry unknown"}</p>
        <p className="mt-2 text-sm">{prospect.description || "No description stored."}</p>
        <p className="mt-2 text-sm">Source: {prospect.source}{prospect.sourceUrl ? ` · ${prospect.sourceUrl}` : ""}</p>
        <form action={queueResearch} className="mt-4"><input type="hidden" name="id" value={prospect.id} /><SubmitButton pendingLabel="Queuing">Queue research</SubmitButton></form>
      </Panel>
      <Panel>
        <h2 className="font-display text-2xl">Edit</h2>
        <form action={updateProspect} className="mt-3 grid gap-2">
          <input type="hidden" name="id" value={prospect.id} />
          <input name="companyName" defaultValue={prospect.companyName} required />
          <input name="website" defaultValue={prospect.website ?? ""} placeholder="Website" />
          <input name="industry" defaultValue={prospect.industry ?? ""} placeholder="Industry" />
          <input name="country" defaultValue={prospect.country ?? ""} placeholder="Country" />
          <input name="city" defaultValue={prospect.city ?? ""} placeholder="City" />
          <input name="address" defaultValue={prospect.address ?? ""} placeholder="Address" />
          <input name="phone" defaultValue={prospect.phone ?? ""} placeholder="Phone" />
          <input name="companySize" defaultValue={prospect.companySize ?? ""} placeholder="Company size" />
          <input name="linkedinUrl" defaultValue={prospect.linkedinUrl ?? ""} placeholder="LinkedIn" />
          <input name="facebookUrl" defaultValue={prospect.facebookUrl ?? ""} placeholder="Facebook" />
          <input name="instagramUrl" defaultValue={prospect.instagramUrl ?? ""} placeholder="Instagram" />
          <textarea name="description" rows={3} defaultValue={prospect.description ?? ""} placeholder="Description" />
          <textarea name="notes" rows={3} defaultValue={prospect.notes ?? ""} placeholder="Internal notes" />
          <input name="recommendedService" defaultValue={prospect.recommendedService ?? ""} placeholder="Recommended service" />
          <textarea name="opportunityReason" rows={2} defaultValue={prospect.opportunityReason ?? ""} placeholder="Opportunity reason" />
          <SubmitButton pendingLabel="Saving">Save changes</SubmitButton>
        </form>
      </Panel>
      <form action={updateProspectNotes} className="lg:col-span-2 space-y-2">
        <input type="hidden" name="id" value={prospect.id} />
        <label className="text-sm text-muted">Notes<textarea name="notes" rows={3} defaultValue={prospect.notes ?? ""} /></label>
        <SubmitButton variant="secondary" pendingLabel="Saving">Save notes</SubmitButton>
      </form>
      <form action={deleteProspect} className="lg:col-span-2 space-y-2 rounded-2xl border border-line p-4">
        <input type="hidden" name="id" value={prospect.id} />
        <label className="flex items-center gap-2 text-sm"><input className="w-auto" type="checkbox" name="confirm" value="yes" required /> Delete this prospect, its contacts, and its messages</label>
        <SubmitButton variant="secondary" pendingLabel="Deleting">Delete prospect</SubmitButton>
      </form>
    </div>
  );
}

function Research({ prospect }: { prospect: ProspectView }) {
  return (
    <Panel>
      <h2 className="font-display text-2xl">Research</h2>
      <p className="mt-2 text-sm">Status: {prospect.researchStatus}</p>
      {prospect.research.length === 0 ? <p className="mt-3 text-sm text-muted">No research record yet. Queue research from Overview after a public website is saved.</p> : prospect.research.map((record) => (
        <div key={record.id} className="mt-4 border-t border-line pt-3 text-sm">
          <p>{record.fetchMethod} · {record.sourceType} · {record.createdAt.toISOString().slice(0, 16).replace("T", " ")}</p>
          <p><a href={record.url}>{record.title || record.url}</a></p>
          <p className="text-muted">{record.metaDescription}</p>
          <p className="mt-2">{record.content?.slice(0, 500) || record.excerpt?.slice(0, 500) || "No extracted text."}</p>
          <p className="mt-2">Technologies: {record.technologies.join(", ") || "None observed"}</p>
          <p>Services: {record.services.join(", ") || "None observed"}</p>
          <p>Confidence: {record.confidence ?? "unknown"}</p>
        </div>
      ))}
    </Panel>
  );
}

function Opportunity({ prospect, ai }: { prospect: ProspectView; ai: boolean }) {
  return (
    <div className="grid gap-4">
      <Panel>
        <h2 className="font-display text-2xl">Stored qualification</h2>
        <p className="mt-2 text-sm">{ai ? "DeepSeek is configured." : "AI integration not configured"}</p>
        <p className="mt-2 text-sm">{prospect.researchSummary || "No AI summary is stored."}</p>
        <p className="mt-2 text-sm text-muted">{prospect.opportunityReason || "No opportunity reason is stored."}</p>
        <p className="mt-2 text-sm">Software {prospect.softwareOpportunity ?? "unknown"} · Advertising {prospect.advertisingOpportunity ?? "unknown"} · Automation {prospect.automationOpportunity ?? "unknown"}</p>
        <p className="mt-2 text-sm">Recommended service: {prospect.recommendedService || "unknown"}</p>
      </Panel>
      {prospect.opportunities.map((item) => (
        <Panel key={item.id}>
          <p className="text-sm text-muted">{item.kind} · {item.status} · confidence {item.confidence} · value {item.potentialValue || "unknown"}</p>
          <h3 className="font-display text-xl">{item.title || item.kind}</h3>
          <p className="mt-2 text-sm">{item.description || item.interpretation}</p>
          <p className="mt-2 text-sm text-muted">Evidence: {Array.isArray(item.evidence) ? item.evidence.join(" ") : "None stored"}</p>
        </Panel>
      ))}
      <Panel>
        <h2 className="font-display text-2xl">Record an observation</h2>
        <p className="mt-2 text-sm text-muted">This stores what you entered. It does not invent revenue.</p>
        <form action={addOpportunity} className="mt-3 grid gap-2">
          <input type="hidden" name="prospectId" value={prospect.id} />
          <select name="kind" defaultValue="CUSTOM_SOFTWARE">
            {["CUSTOM_SOFTWARE", "SOFTWARE_REPLACEMENT", "AUTOMATION", "ADVERTISING_MANAGEMENT", "ADVERTISING_OPTIMIZATION", "OTHER"].map((kind) => <option key={kind}>{kind}</option>)}
          </select>
          <input name="title" placeholder="Title" required />
          <textarea name="description" rows={3} placeholder="What you observed" />
          <textarea name="evidence" rows={3} placeholder="Evidence you can point to" required />
          <input name="recommendedService" placeholder="Recommended service" />
          <select name="potentialValue" defaultValue="unknown"><option>unknown</option><option>low</option><option>moderate</option><option>high</option></select>
          <input name="confidence" type="number" min={0} max={100} defaultValue={40} />
          <SubmitButton pendingLabel="Saving">Save observation</SubmitButton>
        </form>
      </Panel>
    </div>
  );
}

function Contacts({ prospect }: { prospect: ProspectView }) {
  return (
    <div className="grid gap-4">
      {prospect.contacts.length === 0 ? <p className="text-sm text-muted">No contact is stored. Names are not guessed.</p> : prospect.contacts.map((contact) => (
        <Panel key={contact.id}>
          <p>{contact.fullName || "Name unknown"} · {contact.jobTitle || "Title unknown"}{contact.isPrimary ? " · primary" : ""}</p>
          <p className="text-sm text-muted">{contact.email || "No email"} · {contact.phone || "No phone"} · confidence {contact.confidence} · {contact.source}</p>
          <p className="text-sm">{contact.notes}</p>
          <div className="mt-2 flex gap-2">
            {contact.isPrimary ? null : <form action={setPrimaryContact}><input type="hidden" name="id" value={contact.id} /><SubmitButton variant="secondary" pendingLabel="Saving">Make primary</SubmitButton></form>}
            <form action={deleteContact} className="flex items-center gap-2">
              <input type="hidden" name="id" value={contact.id} />
              <input className="w-auto" type="checkbox" name="confirm" value="yes" required aria-label="Confirm contact deletion" />
              <SubmitButton variant="secondary" pendingLabel="Deleting">Delete</SubmitButton>
            </form>
          </div>
        </Panel>
      ))}
      <Panel>
        <h2 className="font-display text-2xl">Add contact</h2>
        <form action={createContact} className="mt-3 grid gap-2 md:grid-cols-2">
          <input type="hidden" name="prospectId" value={prospect.id} />
          <input name="firstName" placeholder="First name" />
          <input name="lastName" placeholder="Last name" />
          <input name="jobTitle" placeholder="Job title" />
          <input name="email" type="email" placeholder="Email" />
          <input name="phone" placeholder="Phone" />
          <input name="linkedinUrl" placeholder="LinkedIn" />
          <input name="confidence" type="number" min={0} max={100} defaultValue={50} />
          <textarea className="md:col-span-2" name="notes" rows={2} placeholder="Notes" />
          <SubmitButton pendingLabel="Saving">Save contact</SubmitButton>
        </form>
      </Panel>
    </div>
  );
}

function Outreach({ prospect }: { prospect: ProspectView }) {
  return (
    <div className="grid gap-4">
      {prospect.messages.length === 0 ? <p className="text-sm text-muted">No message is stored. A draft stays a draft until someone approves it.</p> : prospect.messages.map((message) => (
        <Panel key={message.id}>
          <p className="text-sm text-muted">{message.state}{message.sentAt ? ` · sent ${message.sentAt.toISOString().slice(0, 16).replace("T", " ")}` : ""}{message.deliveredAt ? " · delivered" : ""}</p>
          <h3 className="font-display text-xl">{message.subject}</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm">{message.body}</p>
        </Panel>
      ))}
      <Panel>
        <h2 className="font-display text-2xl">Save a draft</h2>
        <form action={saveOutreachDraft} className="mt-3 space-y-2">
          <input type="hidden" name="prospectId" value={prospect.id} />
          <input name="subject" placeholder="Subject" required />
          <textarea name="body" rows={8} placeholder="Body" required />
          <SubmitButton pendingLabel="Saving">Save draft</SubmitButton>
        </form>
      </Panel>
    </div>
  );
}

function Conversation({ prospect }: { prospect: ProspectView }) {
  if (prospect.conversations.length === 0) return <p className="text-sm text-muted">No conversation yet. Approving outreach creates the thread.</p>;
  return (
    <div className="grid gap-4">
      {prospect.conversations.map((conversation) => (
        <Panel key={conversation.id}>
          <h2 className="font-display text-2xl">{conversation.subject}</h2>
          {conversation.messages.map((message) => <p key={message.id} className="mt-2 text-sm">Outbound · {message.state} · {message.subject}</p>)}
          {conversation.replies.map((reply) => (
            <div key={reply.id} className="mt-3 text-sm">
              <p>Reply · {reply.classification} · {reply.receivedAt.toISOString().slice(0, 16).replace("T", " ")}</p>
              <p className="text-muted">{reply.body.slice(0, 400)}</p>
              {reply.suggestedBody ? <p className="mt-1">Suggested: {reply.suggestedSubject}</p> : <p className="mt-1 text-muted">No suggested response stored.</p>}
            </div>
          ))}
          <p className="mt-3 text-sm"><Link href={`/inbox/${conversation.id}`}>Open in inbox</Link></p>
        </Panel>
      ))}
    </div>
  );
}

function Activity({ prospect }: { prospect: ProspectView }) {
  if (prospect.activity.length === 0) return <p className="text-sm text-muted">No activity yet.</p>;
  return (
    <Panel>
      {prospect.activity.map((entry) => (
        <p key={entry.id} className="border-b border-line py-2 text-sm">{entry.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {entry.action}{entry.detail ? ` · ${entry.detail}` : ""}</p>
      ))}
    </Panel>
  );
}

type ProspectView = {
  id: string;
  companyName: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  description: string | null;
  companySize: string | null;
  linkedinUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  source: string;
  sourceUrl: string | null;
  researchStatus: string;
  qualificationStatus: string;
  outreachState: string;
  notes: string | null;
  researchSummary: string | null;
  opportunityReason: string | null;
  recommendedService: string | null;
  softwareOpportunity: number | null;
  advertisingOpportunity: number | null;
  automationOpportunity: number | null;
  tags: Array<{ tagId: string; tag: { name: string } }>;
  research: Array<{ id: string; url: string; fetchMethod: string; sourceType: string; title: string | null; metaDescription: string | null; excerpt: string | null; content: string | null; technologies: string[]; services: string[]; confidence: number | null; createdAt: Date }>;
  opportunities: Array<{ id: string; kind: string; status: string; title: string | null; description: string | null; interpretation: string; evidence: unknown; potentialValue: string | null; confidence: number; recommendedService: string | null }>;
  contacts: Array<{ id: string; fullName: string | null; jobTitle: string | null; email: string | null; phone: string | null; confidence: number; source: string; notes: string | null; isPrimary: boolean }>;
  messages: Array<{ id: string; state: string; subject: string; body: string; sentAt: Date | null; deliveredAt: Date | null }>;
  conversations: Array<{ id: string; subject: string; messages: Array<{ id: string; state: string; subject: string }>; replies: Array<{ id: string; classification: string; body: string; receivedAt: Date; suggestedSubject: string | null; suggestedBody: string | null }> }>;
  activity: Array<{ id: string; action: string; detail: string | null; createdAt: Date }>;
};
