import { NextResponse } from "next/server";
import { processOutreachScan } from "@/worker/processors/outreach-scan";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await processOutreachScan();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
