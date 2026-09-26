import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { requireOrganization } from "@/lib/current-user";
import { gmailAuthUrl } from "@/lib/email/gmail";

export const dynamic = "force-dynamic";

export async function GET() {
  const { organization, user } = await requireOrganization("ADMIN");
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.redirect(new URL("/integrations?error=AUTH_SECRET+is+not+configured.", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
  }
  const state = await new SignJWT({ organizationId: organization.id, userId: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(secret));
  try {
    return NextResponse.redirect(gmailAuthUrl(state));
  } catch {
    return NextResponse.redirect(new URL("/integrations?error=Gmail+OAuth+is+not+configured.", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
  }
}
