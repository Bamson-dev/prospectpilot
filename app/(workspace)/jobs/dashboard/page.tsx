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

  // Fetch applications for Operational Counter
  const target = 500; // Target configurable in future
  const applications = await prisma.jobApplication.findMany({
    where: { organizationId: organization.id, updatedAt: { gte: today } },
    select: { status: true, submittedAt: true, id: true }
  });

  let verifiedSubmitted = 0;
  let unverified = 0;
  let manualAction = 0;
  let failed = 0;
  const applicationIds = new Set(applications.map(a => a.id));

  for (const app of applications) {
    if (app.status === "SUBMITTED" || app.status === "VERIFIED" || app.submittedAt) verifiedSubmitted++;
    if (app.status === "SUBMISSION_UNVERIFIED") unverified++;
    if (app.status === "REQUIRES_MANUAL_ACTION") manualAction++;
    if (app.status === "FAILED" || app.status.includes("REQUIRED") && app.status !== "REQUIRES_MANUAL_ACTION" || app.status.includes("CHALLENGE")) failed++;
  }

  // Count distinct attempts made today
  const attempts = await prisma.applicationBrowserSession.groupBy({
    by: ['applicationId'],
    where: { 
      applicationId: { in: Array.from(applicationIds) }, 
      endedAt: { gte: today },
      status: "COMPLETED" // Or reached step that attempted submit
    },
    _count: true
  });
  const attemptCount = attempts.length;
  const remaining = Math.max(0, target - attemptCount);

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
          <h2 className="text-xl font-display mb-4">Autonomous Application Queue</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 text-center">
            <div className="p-4 bg-muted/20 rounded">
              <p className="text-3xl font-display">{target}</p>
              <p className="text-xs text-muted mt-1 uppercase tracking-wider">Target</p>
            </div>
            <div className="p-4 bg-primary/10 rounded border border-primary/20">
              <p className="text-3xl font-display text-primary">{verifiedSubmitted}</p>
              <p className="text-xs text-primary/80 mt-1 uppercase tracking-wider">Verified Submitted</p>
            </div>
            <div className="p-4 bg-muted/20 rounded">
              <p className="text-3xl font-display">{attemptCount}</p>
              <p className="text-xs text-muted mt-1 uppercase tracking-wider">Attempts</p>
            </div>
            <div className="p-4 bg-muted/20 rounded">
              <p className="text-3xl font-display">{unverified}</p>
              <p className="text-xs text-muted mt-1 uppercase tracking-wider">Unverified</p>
            </div>
            <div className="p-4 bg-muted/20 rounded">
              <p className="text-3xl font-display">{manualAction}</p>
              <p className="text-xs text-muted mt-1 uppercase tracking-wider">Manual Action</p>
              <Link href="/applications/manual-actions" className="text-primary text-xs mt-1 block hover:underline">View &rarr;</Link>
            </div>
            <div className="p-4 bg-muted/20 rounded">
              <p className="text-3xl font-display text-destructive">{failed}</p>
              <p className="text-xs text-muted mt-1 uppercase tracking-wider">Failed</p>
            </div>
            <div className="p-4 bg-muted/20 rounded">
              <p className="text-3xl font-display opacity-50">{remaining}</p>
              <p className="text-xs text-muted mt-1 uppercase tracking-wider">Remaining</p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
