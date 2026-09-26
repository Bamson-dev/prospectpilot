import Link from "next/link";
import { Empty, PageHeader } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Research" };

export default async function ResearchPage() {
  const { organization } = await requireOrganization();
  const records = await prisma.researchRecord.findMany({
    where: { prospect: { organizationId: organization.id } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { prospect: true },
  });
  return (
    <div>
      <PageHeader title="Research" detail="Each row is a stored page fetch. HTTP is used first. Playwright runs only when the page text is too thin." />
      {records.length === 0 ? <Empty title="No research yet" detail="Queue research from a prospect that has a public website." /> : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table>
            <thead><tr><th>Company</th><th>Method</th><th>Title</th><th>When</th></tr></thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td><Link href={`/prospects/${record.prospectId}`}>{record.prospect.companyName}</Link></td>
                  <td>{record.fetchMethod}</td>
                  <td>{record.title || record.url}</td>
                  <td>{record.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
