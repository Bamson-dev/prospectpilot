import Link from "next/link";
import { createProspect } from "@/actions/prospects";
import { Empty, Flash, PageHeader, Pill } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import type { OutreachState, Prisma, QualificationStatus, ResearchStatus } from "@prisma/client";

const RESEARCH: ResearchStatus[] = ["PENDING", "QUEUED", "IN_PROGRESS", "COMPLETED", "FAILED", "SKIPPED"];
const QUALIFICATION: QualificationStatus[] = ["UNREVIEWED", "QUALIFIED", "REJECTED", "APPROVED", "SKIPPED"];
const OUTREACH: OutreachState[] = ["NONE", "PENDING_APPROVAL", "QUEUED", "SENT", "REPLIED", "FAILED", "SUPPRESSED"];

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]) {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export const metadata = { title: "Prospects" };

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const page = Math.max(1, Number(query.page || 1) || 1);
  const where: Prisma.ProspectWhereInput = {
    organizationId: organization.id,
    ...(query.q ? { companyName: { contains: query.q, mode: "insensitive" } } : {}),
    ...(query.industry ? { industry: { contains: query.industry, mode: "insensitive" } } : {}),
    ...(query.country ? { country: { equals: query.country, mode: "insensitive" } } : {}),
    ...(query.city ? { city: { equals: query.city, mode: "insensitive" } } : {}),
    ...(oneOf(query.research, RESEARCH) ? { researchStatus: oneOf(query.research, RESEARCH) } : {}),
    ...(oneOf(query.qualification, QUALIFICATION) ? { qualificationStatus: oneOf(query.qualification, QUALIFICATION) } : {}),
    ...(oneOf(query.outreach, OUTREACH) ? { outreachState: oneOf(query.outreach, OUTREACH) } : {}),
  };
  if (query.contact === "yes") where.contacts = { some: { email: { not: null } } };
  if (query.contact === "no") where.contacts = { none: { email: { not: null } } };
  const orderBy: Prisma.ProspectOrderByWithRelationInput =
    query.sort === "company" ? { companyName: "asc" } : query.sort === "score" ? { opportunityScore: "desc" } : query.sort === "activity" ? { updatedAt: "desc" } : { createdAt: "desc" };
  const [prospects, total, campaigns] = await Promise.all([
    prisma.prospect.findMany({ where, orderBy, skip: (page - 1) * 25, take: 25, include: { contacts: { where: { isPrimary: true }, take: 1 } } }),
    prisma.prospect.count({ where }),
    prisma.campaign.findMany({ where: { organizationId: organization.id }, select: { id: true, name: true } }),
  ]);
  return (
    <div>
      <PageHeader title="Prospects" detail="Companies stay empty until discovery or a manual entry stores them." />
      <Flash error={query.error} notice={query.notice} />
      <form className="mb-4 grid gap-2 md:grid-cols-4" action="/prospects">
        <input name="q" defaultValue={query.q} placeholder="Company" />
        <input name="industry" defaultValue={query.industry} placeholder="Industry" />
        <input name="country" defaultValue={query.country} placeholder="Country" />
        <input name="city" defaultValue={query.city} placeholder="City" />
        <select name="research" defaultValue={query.research || ""}><option value="">Any research</option>{["PENDING", "QUEUED", "IN_PROGRESS", "COMPLETED", "FAILED", "SKIPPED"].map((item) => <option key={item}>{item}</option>)}</select>
        <select name="qualification" defaultValue={query.qualification || ""}><option value="">Any qualification</option>{["UNREVIEWED", "QUALIFIED", "REJECTED", "APPROVED", "SKIPPED"].map((item) => <option key={item}>{item}</option>)}</select>
        <select name="outreach" defaultValue={query.outreach || ""}><option value="">Any outreach</option>{["NONE", "PENDING_APPROVAL", "QUEUED", "SENT", "REPLIED", "FAILED", "SUPPRESSED"].map((item) => <option key={item}>{item}</option>)}</select>
        <select name="sort" defaultValue={query.sort || "newest"}><option value="newest">Newest</option><option value="score">Opportunity</option><option value="company">Company</option><option value="activity">Last activity</option></select>
        <select name="contact" defaultValue={query.contact || ""}><option value="">Any contact</option><option value="yes">Has email</option><option value="no">No email</option></select>
        <button className="button button-secondary" type="submit">Filter</button>
      </form>
      <form action={createProspect} className="mb-6 grid gap-2 rounded-2xl border border-line bg-panel p-4 md:grid-cols-4">
        <input name="companyName" placeholder="Company name" required />
        <input name="website" placeholder="https://example.com" />
        <input name="industry" placeholder="Industry" />
        <select name="campaignId" defaultValue=""><option value="">No campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>
        <div className="md:col-span-4"><SubmitButton pendingLabel="Saving">Add prospect</SubmitButton></div>
      </form>
      {prospects.length === 0 ? <Empty title="No prospects" detail="Start a campaign or add a company with a public website." /> : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table>
            <thead><tr><th>Company</th><th>Location</th><th>Industry</th><th>Opportunity</th><th>Contact</th><th>Research</th><th>Qualification</th><th>Outreach</th></tr></thead>
            <tbody>
              {prospects.map((prospect) => (
                <tr key={prospect.id}>
                  <td><Link href={`/prospects/${prospect.id}`}>{prospect.companyName}</Link><div className="text-xs text-muted">{prospect.domain}</div></td>
                  <td>{[prospect.city, prospect.country].filter(Boolean).join(", ") || "—"}</td>
                  <td>{prospect.industry || "—"}</td>
                  <td>{prospect.opportunityScore ?? "—"}</td>
                  <td>{prospect.contacts[0]?.email || "—"}</td>
                  <td><Pill>{prospect.researchStatus}</Pill></td>
                  <td><Pill>{prospect.qualificationStatus}</Pill></td>
                  <td><Pill>{prospect.outreachState}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-sm text-muted">{total} companies · page {page}</p>
      <div className="mt-2 flex gap-3 text-sm">
        {page > 1 ? <Link href={`/prospects?page=${page - 1}`}>Previous</Link> : null}
        {page * 25 < total ? <Link href={`/prospects?page=${page + 1}`}>Next</Link> : null}
      </div>
    </div>
  );
}
