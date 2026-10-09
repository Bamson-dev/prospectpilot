import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { processOutreachScan } from "@/worker/processors/outreach-scan";
import { authorizeAdmin } from "@/app/api/diagnostics/discovery/route";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Runs the existing outreach scan. The scan still returns immediately while OUTREACH_SEND_ENABLED
// is off, only touches campaigns with requireApproval=false, and skips suppressed contacts. The send
// worker repeats the suppression, eligibility and limit checks before any message leaves.
export async function POST(request: Request) {
  const auth = await authorizeAdmin(request);
  if (!auth) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  try {
    await processOutreachScan();
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Outreach scan failed." }, { status: 500, headers: NO_STORE });
  }
}

// Read-only counts for the caller's organization. No message text, recipients or error details.
export async function GET(request: Request) {
  const auth = await authorizeAdmin(request);
  if (!auth) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  try {
    const organizationId = auth.organization.id;
    const [messages, jobs] = await Promise.all([
      prisma.outreachMessage.groupBy({ by: ["state"], where: { organizationId }, _count: { _all: true } }),
      prisma.backgroundJob.groupBy({ by: ["state"], where: { organizationId, name: "outreach.send" }, _count: { _all: true } }),
    ]);
    return NextResponse.json(
      {
        states: Object.fromEntries(messages.map((row) => [row.state, row._count._all])),
        jobStates: Object.fromEntries(jobs.map((row) => [row.state, row._count._all])),
      },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json({ error: "Diagnostic failed." }, { status: 500, headers: NO_STORE });
  }
}
