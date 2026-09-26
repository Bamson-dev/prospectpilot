import Link from "next/link";
import { Empty, PageHeader, Pill } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const { organization } = await requireOrganization();
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId: organization.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { prospects: true } } },
  });
  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <PageHeader title="Campaigns" detail="A campaign holds the search, the daily limits, and the approval rules." />
        <Link className="button button-primary" href="/campaigns/new">New campaign</Link>
      </div>
      {campaigns.length === 0 ? <Empty title="No campaigns yet" detail="Create one with an industry, a city, and the search terms you actually want." /> : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table>
            <thead><tr><th>Name</th><th>Place</th><th>Status</th><th>Prospects</th></tr></thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td><Link href={`/campaigns/${campaign.id}`}>{campaign.name}</Link></td>
                  <td>{[campaign.city, campaign.country].filter(Boolean).join(", ") || "—"}</td>
                  <td><Pill>{campaign.status}</Pill></td>
                  <td>{campaign._count.prospects}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
