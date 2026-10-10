import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/session";
import { suppressContactForUnsubscribe } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

// RFC 8058 one-click unsubscribe. Mail clients send POST with the body "List-Unsubscribe=One-Click"
// and no cookies. The signed token identifies the contact, so no login is needed. GET does nothing,
// so link scanners that prefetch the URL cannot unsubscribe anyone.
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const body = await request.text().catch(() => "");
  if (!token || new URLSearchParams(body).get("List-Unsubscribe") !== "One-Click") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const contactId = await verifyUnsubscribeToken(token);
  if (!contactId) return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  const email = await suppressContactForUnsubscribe(prisma, contactId);
  if (!email) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
