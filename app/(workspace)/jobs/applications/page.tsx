import { batchDecideApplications } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Empty, Flash, PageHeader, Panel } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Applications" };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; sort?: string; filter?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const sort = query.sort === "match" ? { vacancy: { fit: { overallMatch: "desc" as const } } } : { createdAt: "desc" as const };
  const filter = query.filter || "ALL";

  const applications = await prisma.jobApplication.findMany({
    where: { 
      organizationId: organization.id,
      ...(filter === "REVIEW_REQUIRED" ? { status: { in: ["READY_FOR_REVIEW", "REQUIRES_REVIEW", "REQUIRES_MANUAL_ACTION"] } } : {}),
      ...(filter === "APPROVED" ? { status: { in: ["APPROVED", "READY_FOR_SUBMISSION", "READY_TO_SUBMIT"] } } : {}),
      ...(filter === "SUBMITTED" ? { status: { in: ["SUBMITTED", "VERIFIED"] } } : {}),
    },
    orderBy: sort,
    include: { vacancy: { include: { fit: true } }, package: true },
    take: 100,
  });

  return (
    <div>
      <PageHeader title="Human Review Queue" detail="Review your applications. Automation strictly stops before submission." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      
      {applications.length === 0 ? <Empty title="No applications" detail="No applications match this filter." /> : (
        <form action={batchDecideApplications} className="mt-4">
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded bg-muted/20 p-3">
            <span className="text-sm font-semibold mr-2">Batch Actions:</span>
            <button type="submit" name="decision" value="APPROVED" className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm font-medium">Approve Selected</button>
            <input name="reason" placeholder="Rejection reason..." className="rounded border border-line px-2 py-1 text-sm" />
            <button type="submit" name="decision" value="REJECTED" className="px-3 py-1 bg-secondary text-secondary-foreground rounded text-sm font-medium">Reject Selected</button>
            
            <div className="ml-auto flex gap-2 text-sm">
              <a href="?filter=ALL" className={`px-2 py-1 rounded ${filter === "ALL" ? "bg-primary text-primary-foreground" : "bg-muted/30"}`}>All</a>
              <a href="?filter=REVIEW_REQUIRED" className={`px-2 py-1 rounded ${filter === "REVIEW_REQUIRED" ? "bg-primary text-primary-foreground" : "bg-muted/30"}`}>Needs Review</a>
              <a href="?filter=APPROVED" className={`px-2 py-1 rounded ${filter === "APPROVED" ? "bg-primary text-primary-foreground" : "bg-muted/30"}`}>Approved</a>
              <a href="?filter=SUBMITTED" className={`px-2 py-1 rounded ${filter === "SUBMITTED" ? "bg-primary text-primary-foreground" : "bg-muted/30"}`}>Submitted</a>
              <span className="mx-1 text-muted">|</span>
              <a href={`?sort=${query.sort === "match" ? "recent" : "match"}&filter=${filter}`} className="px-2 py-1 rounded bg-muted/30">Sort: {query.sort === "match" ? "Match" : "Recent"}</a>
            </div>
          </div>
          <div className="space-y-4">
            {applications.map((item) => (
              <Panel key={item.id}>
                <div className="flex justify-between items-start">
                  <div className="flex gap-4">
                    <div className="pt-1">
                      <input type="checkbox" name="id" value={item.id} className="h-5 w-5 rounded border-line" />
                    </div>
                    <div>
                      <p className="font-display text-2xl"><a href={`/jobs/applications/${item.id}`}>{item.vacancy.title}</a></p>
                      <p className="text-sm text-muted">{item.vacancy.companyName} · {item.vacancy.location ?? "Unknown location"}</p>
                      <div className="mt-2 text-sm flex gap-4">
                        <span className="bg-muted/20 px-2 py-1 rounded">Profile: {item.profile}</span>
                        <span className="bg-muted/20 px-2 py-1 rounded">Status: <strong className={item.status.includes("REQUIRED") || item.status.includes("LIMITED") ? "text-destructive" : ""}>{item.status}</strong></span>
                        {item.blockedReason && <span className="bg-destructive/10 text-destructive px-2 py-1 rounded">Blocker: {item.blockedReason}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-sm space-y-1">
                    <p><strong>Match:</strong> {item.vacancy.fit?.overallMatch ?? 0}%</p>
                    {item.cvId ? <p className="text-primary">✓ CV</p> : <p className="text-muted">⏳ No CV</p>}
                    {item.coverLetterId ? <p className="text-primary">✓ Letter</p> : <p className="text-muted">⏳ No Letter</p>}
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        </form>
      )}
    </div>
  );
}
