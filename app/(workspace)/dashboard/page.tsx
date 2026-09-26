import Link from "next/link";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { credentialStatus, integrationLabel } from "@/lib/integrations/status";
import { workspaceMetrics } from "@/lib/metrics";
import { getRedis } from "@/lib/queues";

export const metadata = { title: "Dashboard" };

const LABELS: Array<[keyof Awaited<ReturnType<typeof workspaceMetrics>>, string]> = [
  ["prospects", "Discovered"],
  ["researched", "Researched"],
  ["qualified", "Qualified"],
  ["approved", "Approved"],
  ["sent", "Sent"],
  ["delivered", "Delivered"],
  ["opened", "Opened"],
  ["replies", "Replies"],
  ["interested", "Interested"],
  ["meetings", "Meetings"],
  ["deals", "Deals"],
];

export default async function DashboardPage() {
  const { organization } = await requireOrganization();
  const metrics = await workspaceMetrics(organization.id);
  const [campaigns, replies, pending, failed, activity, accounts, activeCampaigns] = await Promise.all([
    prisma.campaign.findMany({ where: { organizationId: organization.id }, orderBy: { updatedAt: "desc" }, take: 5 }),
    prisma.reply.findMany({ where: { organizationId: organization.id }, orderBy: { receivedAt: "desc" }, take: 5, include: { conversation: { include: { prospect: true } } } }),
    prisma.outreachMessage.findMany({ where: { organizationId: organization.id, state: "PENDING_APPROVAL" }, orderBy: { updatedAt: "desc" }, take: 5, include: { prospect: true } }),
    prisma.backgroundJob.findMany({ where: { organizationId: organization.id, state: "FAILED" }, orderBy: { finishedAt: "desc" }, take: 5 }),
    prisma.activityLog.findMany({ where: { organizationId: organization.id }, orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.emailAccount.findMany({ where: { organizationId: organization.id }, select: { provider: true, status: true } }),
    prisma.campaign.count({ where: { organizationId: organization.id, status: { in: ["DISCOVERY", "RESEARCHING", "ACTIVE"] } } }),
  ]);
  const integrations = credentialStatus(accounts);
  const health = await systemHealth();
  return (
    <div>
      <PageHeader title="Dashboard" detail="Counts come from this workspace only. Empty numbers stay at zero." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {LABELS.map(([key, label]) => (
          <Panel key={key}><p className="text-xs uppercase tracking-wider text-muted">{label}</p><p className="mt-2 font-display text-3xl">{metrics[key]}</p></Panel>
        ))}
        <Panel><p className="text-xs uppercase tracking-wider text-muted">Active campaigns</p><p className="mt-2 font-display text-3xl">{activeCampaigns}</p></Panel>
        <Panel><p className="text-xs uppercase tracking-wider text-muted">Pipeline value</p><p className="mt-2 text-sm text-muted">No deal values are stored yet.</p></Panel>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-3 font-display text-2xl">Recent campaigns</h2>
          {campaigns.length === 0 ? <Empty title="No campaigns" detail="Create a campaign before discovery can run." /> : campaigns.map((campaign) => (
            <p key={campaign.id} className="flex justify-between border-b border-line py-2 text-sm"><Link href={`/campaigns/${campaign.id}`}>{campaign.name}</Link><span className="text-muted">{campaign.status}</span></p>
          ))}
        </Panel>
        <Panel>
          <h2 className="mb-3 font-display text-2xl">Pending approvals</h2>
          {pending.length === 0 ? <Empty title="Nothing waiting" detail="Qualified prospects with a public email appear here after AI drafting." /> : pending.map((item) => (
            <p key={item.id} className="border-b border-line py-2 text-sm"><Link href="/outreach">{item.prospect.companyName}</Link> · {item.subject}</p>
          ))}
        </Panel>
        <Panel>
          <h2 className="mb-3 font-display text-2xl">Recent replies</h2>
          {replies.length === 0 ? <Empty title="No replies" detail="Replies show up after Gmail sync or a Resend inbound webhook." /> : replies.map((reply) => (
            <p key={reply.id} className="border-b border-line py-2 text-sm"><Link href={`/inbox/${reply.conversationId}`}>{reply.conversation.prospect.companyName}</Link> · {reply.classification}</p>
          ))}
        </Panel>
        <Panel>
          <h2 className="mb-3 font-display text-2xl">System</h2>
          <p className="text-sm">Database: {health.database === "up" ? "connected" : "disconnected"}</p>
          <p className="text-sm">Redis: {health.redis === "up" ? "connected" : health.redis === "not configured" ? "not configured" : "disconnected"}</p>
          <p className="mt-2 text-sm">Google Search: {integrationLabel(integrations.googleSearch)}</p>
          <p className="text-sm">DeepSeek: {integrationLabel(integrations.deepseek)}</p>
          <p className="text-sm">Resend: {integrationLabel(integrations.resend)}</p>
          <p className="text-sm">Gmail: {integrationLabel(integrations.gmail)}</p>
          <h3 className="mt-4 text-sm text-muted">Recent activity</h3>
          {activity.length === 0 ? <p className="mt-2 text-sm text-muted">No activity yet.</p> : activity.map((entry) => (
            <p key={entry.id} className="mt-2 text-sm">{entry.action}{entry.detail ? ` · ${entry.detail}` : ""}</p>
          ))}
          <h3 className="mt-4 text-sm text-muted">Failed jobs</h3>
          {failed.length === 0 ? <p className="mt-2 text-sm text-muted">No failed jobs.</p> : failed.map((job) => (
            <p key={job.id} className="mt-2 text-sm">{job.queue}: {job.error}</p>
          ))}
        </Panel>
      </div>
    </div>
  );
}

async function systemHealth() {
  let database = "down";
  let redis = process.env.REDIS_URL ? "down" : "not configured";
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }
  if (process.env.REDIS_URL) {
    try {
      redis = (await getRedis().ping()) === "PONG" ? "up" : "down";
    } catch {
      redis = "down";
    }
  }
  return { database, redis };
}
