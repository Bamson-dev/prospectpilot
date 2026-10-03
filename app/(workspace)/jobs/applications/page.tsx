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
    include: { vacancy: { include: { fit: true } }, package: true },
    take: 100,
  });

  return (
    <div>
      <PageHeader title="Human Review Queue" detail="Review your applications. Automation strictly stops before submission." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      
      {applications.length === 0 ? <Empty title="No applications" detail="Prepare a vacancy to create an application package." /> : (
        <div className="mt-4 space-y-4">
          {applications.map((item) => (
            <Panel key={item.id}>
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-display text-2xl"><a href={`/jobs/applications/${item.id}`}>{item.vacancy.title}</a></p>
                  <p className="text-sm text-muted">{item.vacancy.companyName} · {item.vacancy.location ?? "Unknown location"}</p>
                  <div className="mt-2 text-sm flex gap-4">
                    <span className="bg-muted/20 px-2 py-1 rounded">Profile: {item.profile}</span>
                    <span className="bg-muted/20 px-2 py-1 rounded">Status: <strong className={item.status.includes("REQUIRED") || item.status.includes("LIMITED") ? "text-destructive" : ""}>{item.status}</strong></span>
                    {item.blockedReason && <span className="bg-destructive/10 text-destructive px-2 py-1 rounded">Blocker: {item.blockedReason}</span>}
                  </div>
                </div>
                <div className="text-right text-sm space-y-1">
                  <p><strong>Match:</strong> {item.vacancy.fit?.overallMatch ?? 0}%</p>
                  {item.cvId ? <p className="text-primary">✓ CV Generated</p> : <p className="text-muted">⏳ No CV</p>}
                  {item.coverLetterId ? <p className="text-primary">✓ Cover Letter Generated</p> : <p className="text-muted">⏳ No Cover Letter</p>}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
