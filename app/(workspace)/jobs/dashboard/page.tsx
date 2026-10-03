import { JobsNav } from "@/components/jobs-nav";
import { PageHeader, Panel } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import Link from "next/link";

export const metadata = { title: "Daily Dashboard" };

export default async function DashboardPage() {
  const { organization } = await requireOrganization();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const run = await prisma.jobDiscoveryRun.findFirst({
    where: { organizationId: organization.id, startedAt: { gte: today } },
    orderBy: { startedAt: "desc" },
  });

  const discoveredToday = await prisma.jobVacancy.count({
    where: { organizationId: organization.id, createdAt: { gte: today } }
  });

  // Using fit snapshots for analysis counting


  const fitSnapshots = await prisma.jobFitSnapshot.findMany({
    where: { vacancy: { organizationId: organization.id, createdAt: { gte: today } } },
    select: { recommendation: true }
  });
  
  let applyCount = 0;
  let reviewCount = 0;
  let skipCount = 0;
  for (const fit of fitSnapshots) {
    if (fit.recommendation === "APPLY" || fit.recommendation === "AUTO_PREPARE" || fit.recommendation === "AUTO_SUBMIT") applyCount++;
    else if (fit.recommendation === "SKIP" || fit.recommendation === "DO_NOT_PREPARE") skipCount++;
    else reviewCount++;
  }

  const applications = await prisma.jobApplication.findMany({
    where: { organizationId: organization.id },
    select: { status: true }
  });

  let ready = 0;
  let preparing = 0;
  let blocked = 0;
  let needsReview = 0;
  
  for (const app of applications) {
    if (app.status === "APPROVED" || app.status === "READY_FOR_SUBMISSION" || app.status === "READY_TO_SUBMIT") ready++;
    else if (app.status === "READY_FOR_REVIEW" || app.status === "REQUIRES_REVIEW" || app.status === "REQUIRES_MANUAL_ACTION") needsReview++;
    else if (app.status.includes("REQUIRED") || app.status.includes("LIMITED") || app.status.includes("CHALLENGE") || app.status.includes("NOT_FOUND")) blocked++;
    else preparing++;
  }

  return (
    <div>
      <PageHeader title="Daily Dashboard" detail="Overview of today's autonomous discovery and application operations." />
      <JobsNav />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Panel>
          <h2 className="text-xl font-display mb-4">Discovery Cycle</h2>
          {run ? (
            <div className="space-y-2 text-sm">
              <p><strong>Status:</strong> {run.status}</p>
              <p><strong>Started:</strong> {run.startedAt.toLocaleTimeString()}</p>
              <p><strong>Queries:</strong> {run.queries}</p>
              <p><strong>Raw Results:</strong> {run.rawResults}</p>
              <p><strong>New Opportunities:</strong> {run.newVacancies}</p>
              <p><strong>Duplicates Avoided:</strong> {run.duplicates}</p>
              <p><strong>Rate Limits Hit:</strong> {run.rateLimits}</p>
            </div>
          ) : (
            <p className="text-muted text-sm">No discovery run started today.</p>
          )}
        </Panel>

        <Panel>
          <h2 className="text-xl font-display mb-4">Today&apos;s Pipeline</h2>
          <div className="space-y-2 text-sm">
            <p><strong>Total Discovered:</strong> {discoveredToday}</p>
            <p><strong>APPLY Matches:</strong> {applyCount}</p>
            <p><strong>REVIEW Matches:</strong> {reviewCount}</p>
            <p><strong>NOT A FIT:</strong> {skipCount}</p>
          </div>
        </Panel>

        <Panel className="lg:col-span-2">
          <h2 className="text-xl font-display mb-4">Command Center Queue</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div className="p-4 bg-muted/20 rounded">
              <p className="text-3xl font-display">{preparing}</p>
              <p className="text-sm text-muted mt-1">Preparing</p>
            </div>
            <div className="p-4 bg-muted/20 rounded border-2 border-primary/20">
              <p className="text-3xl font-display">{needsReview}</p>
              <p className="text-sm text-muted mt-1">Needs Human Review</p>
              <Link href="/jobs/applications?filter=REVIEW_REQUIRED" className="mt-2 text-xs text-primary block">View Queue &rarr;</Link>
            </div>
            <div className="p-4 bg-muted/20 rounded">
              <p className="text-3xl font-display">{ready}</p>
              <p className="text-sm text-muted mt-1">Approved & Ready</p>
            </div>
            <div className="p-4 bg-muted/20 rounded">
              <p className="text-3xl font-display text-destructive">{blocked}</p>
              <p className="text-sm text-muted mt-1">Blocked / Requires Auth</p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
