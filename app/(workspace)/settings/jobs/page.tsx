import { Empty, PageHeader } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Jobs" };

export default async function JobsPage() {
  const { organization } = await requireOrganization("ADMIN");
  const jobs = await prisma.backgroundJob.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return (
    <div>
      <PageHeader title="Jobs" detail="Queue work for this workspace. Members cannot open this page." />
      {jobs.length === 0 ? <Empty title="No jobs" detail="Starting a campaign creates the first discovery job." /> : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table>
            <thead><tr><th>Queue</th><th>Name</th><th>Status</th><th>Attempts</th><th>Started</th><th>Finished</th><th>Error</th></tr></thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.queue}</td>
                  <td>{job.name}</td>
                  <td>{job.state}</td>
                  <td>{job.attempts}/{job.maxAttempts}</td>
                  <td>{job.startedAt?.toISOString().slice(0, 16).replace("T", " ") || "—"}</td>
                  <td>{job.finishedAt?.toISOString().slice(0, 16).replace("T", " ") || "—"}</td>
                  <td>{job.error || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
