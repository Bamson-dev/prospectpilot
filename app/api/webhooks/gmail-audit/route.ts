import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { outreachSendingEnabled } from "@/lib/email/send-gate";
import { authorizeAdmin } from "@/app/api/diagnostics/discovery/route";

export const dynamic = "force-dynamic";

// Read-only diagnostic for the Gmail sender. It requires an admin session or the admin bearer token,
// only reads counts for the caller's organization, and never changes campaigns, approvals, jobs or
// messages. It has no write path and ignores query parameters.
export async function GET(request: Request) {
  const auth = await authorizeAdmin(request);
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const organizationId = auth.organization.id;
    const [accounts, campaigns, messages] = await Promise.all([
      prisma.emailAccount.findMany({ where: { organizationId, provider: "GMAIL" }, select: { status: true } }),
      prisma.campaign.groupBy({ by: ["status", "requireApproval"], where: { organizationId }, _count: { _all: true } }),
      prisma.outreachMessage.groupBy({ by: ["state"], where: { organizationId }, _count: { _all: true } }),
    ]);
    return NextResponse.json(
      {
        sendingEnabled: outreachSendingEnabled(),
        gmailAccounts: accounts.map((account) => account.status),
        campaigns: campaigns.map((row) => ({ status: row.status, requireApproval: row.requireApproval, count: row._count._all })),
        messages: Object.fromEntries(messages.map((row) => [row.state, row._count._all])),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Diagnostic failed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
