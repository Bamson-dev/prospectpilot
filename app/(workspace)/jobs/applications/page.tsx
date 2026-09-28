import { JobsNav } from "@/components/jobs-nav";
import { Empty, Flash, PageHeader, Panel } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Applications" };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const applications = await prisma.jobApplication.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "desc" },
    include: { vacancy: true },
    take: 100,
  });
  return (
    <div>
      <PageHeader title="Applications" detail="Submission stays off unless the deployment is explicitly switched to automatic submit. A click is not treated as a submitted application." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      {applications.length === 0 ? <Empty title="No applications" detail="Prepare a vacancy to create an application package." /> : applications.map((item) => (
        <Panel key={item.id} className="mb-3">
          <p className="font-display text-2xl"><a href={`/jobs/applications/${item.id}`}>{item.vacancy.title}</a></p>
          <p className="text-sm text-muted">{item.vacancy.companyName} · {item.status} · {item.profile}</p>
        </Panel>
      ))}
    </div>
  );
}
