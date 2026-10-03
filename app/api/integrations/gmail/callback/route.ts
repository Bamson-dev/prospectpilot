import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { encryptSecret } from "@/lib/crypto";
import { GMAIL_STATE_PURPOSE } from "@/lib/email/gmail";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const secret = process.env.AUTH_SECRET;
  if (!code || !state || !secret) return NextResponse.redirect(new URL("/integrations/gmail?error=Gmail+connection+was+not+completed.", appUrl));
  try {
    const verified = await jwtVerify(state, new TextEncoder().encode(secret));
    if (verified.payload.purpose !== GMAIL_STATE_PURPOSE) {
      return NextResponse.redirect(new URL("/integrations/gmail?error=Gmail+connection+was+not+completed.", appUrl));
    }
    const organizationId = String(verified.payload.organizationId || "");
    if (!organizationId) return NextResponse.redirect(new URL("/integrations/gmail?error=Gmail+connection+was+not+completed.", appUrl));
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GMAIL_CLIENT_ID || "",
        client_secret: process.env.GMAIL_CLIENT_SECRET || "",
        redirect_uri: process.env.GMAIL_REDIRECT_URI || "",
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) return NextResponse.redirect(new URL("/integrations/gmail?error=Gmail+refused+the+authorization+code.", appUrl));
    const tokens = (await tokenResponse.json()) as { refresh_token?: string; access_token?: string };
    if (!tokens.refresh_token || !tokens.access_token) {
      return NextResponse.redirect(new URL("/integrations/gmail?error=Gmail+did+not+return+a+refresh+token.", appUrl));
    }
    const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profileBody = (await profile.json()) as { emailAddress?: string };
    if (!profileBody.emailAddress) return NextResponse.redirect(new URL("/integrations/gmail?error=Gmail+did+not+return+an+address.", appUrl));
    await prisma.emailAccount.create({
      data: {
        organizationId,
        provider: "GMAIL",
        fromEmail: profileBody.emailAddress.toLowerCase(),
        refreshTokenEncrypted: encryptSecret(tokens.refresh_token),
      },
    });
    return NextResponse.redirect(new URL("/integrations/gmail?notice=Gmail+connected.", appUrl));
  } catch {
    return NextResponse.redirect(new URL("/integrations/gmail?error=Gmail+connection+failed.", appUrl));
  }
}
