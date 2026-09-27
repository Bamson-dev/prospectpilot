import Link from "next/link";
import { retryJob } from "@/actions/jobs";
import { Empty, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import type { JobState } from "@prisma/client";

const STATES: JobState[] = ["QUEUED", "ACTIVE", "COMPLETED", "FAILED", "DELAYED", "CANCELLED"];

export const metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ state?: string; queue?: string; error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization("ADMIN");
  const query = await searchParams;
  const state = STATES.includes(query.state as JobState) ? (query.state as JobState) : undefined;
  const jobs = await prisma.backgroundJob.findMany({
    where: {
      organizationId: organization.id,
      ...(state ? { state } : {}),
      ...(query.queue ? { queue: query.queue } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { campaign: { select: { name: true } }, prospect: { select: { companyName: true } } },
  });
  return (
    <div>
      <PageHeader title="Jobs" detail="Queue work for this workspace. A failed job can be retried only until its attempt limit." />
      <Flash error={query.error} notice={query.notice} />
      <form className="mb-4 flex flex-wrap gap-2" action="/settings/jobs">
        <select name="state" defaultValue={query.state || ""}><option value="">Any status</option>{STATES.map((item) => <option key={item} value={item}>{item === "QUEUED" ? "WAITING" : item}</option>)}</select>
        <input name="queue" defaultValue={query.queue} placeholder="Queue" />
        <button className="button button-secondary" type="submit">Filter</button>
      </form>
      {jobs.length === 0 ? <Empty title="No jobs" detail="Starting a campaign creates the first discovery job." /> : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table>
            <thead><tr><th>Queue</th><th>Job</th><th>Provider</th><th>Campaign</th><th>Prospect</th><th>Status</th><th>Attempts</th><th>Created</th><th>Started</th><th>Completed</th><th>Error</th><th></th></tr></thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.queue}</td>
                  <td>{job.name}<div className="text-xs text-muted">{job.id}</div></td>
                  <td>{providerOf(job.payload)}</td>
                  <td>{job.campaign ? <Link href={`/campaigns/${job.campaignId}`}>{job.campaign.name}</Link> : "—"}</td>
                  <td>{job.prospect ? <Link href={`/prospects/${job.prospectId}`}>{job.prospect.companyName}</Link> : "—"}</td>
                  <td>{job.state === "QUEUED" ? "WAITING" : job.state}</td>
                  <td>{job.attempts}/{job.maxAttempts}</td>
                  <td>{job.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td>{job.startedAt?.toISOString().slice(0, 16).replace("T", " ") || "—"}</td>
                  <td>{job.finishedAt?.toISOString().slice(0, 16).replace("T", " ") || "—"}</td>
                  <td>{job.error || "—"}</td>
                  <td>{job.state === "FAILED" && job.attempts < job.maxAttempts ? (
                    <form action={retryJob}><input type="hidden" name="id" value={job.id} /><SubmitButton variant="secondary" pendingLabel="Retrying">Retry</SubmitButton></form>
                  ) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function providerOf(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "—";
  const value = (payload as { provider?: unknown }).provider;
  return typeof value === "string" ? value : "—";
}
