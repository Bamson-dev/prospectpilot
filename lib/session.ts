import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "pp_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  organizationId?: string;
};

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

export async function signSession(payload: SessionPayload) {
  const key = secretKey();
  if (!key) throw new Error("AUTH_SECRET must be at least 32 characters.");
  return new SignJWT({
    email: payload.email,
    name: payload.name,
    ...(payload.organizationId ? { organizationId: payload.organizationId } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  const key = secretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.name !== "string") return null;
    const organizationId = typeof payload.organizationId === "string" && payload.organizationId ? payload.organizationId : undefined;
    return { sub: payload.sub, email: payload.email, name: payload.name, organizationId };
  } catch {
    return null;
  }
}

export async function signUnsubscribeToken(contactId: string) {
  const key = secretKey();
  if (!key) throw new Error("AUTH_SECRET must be at least 32 characters.");
  return new SignJWT({ purpose: "unsubscribe" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(contactId)
    .setExpirationTime("180d")
    .sign(key);
}

export async function verifyUnsubscribeToken(token: string) {
  const key = secretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    if (payload.purpose !== "unsubscribe" || !payload.sub) return null;
    return payload.sub;
  } catch {
    return null;
  }
}
