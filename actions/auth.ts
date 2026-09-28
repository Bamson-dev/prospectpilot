"use server";

import { compare, hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clearSession, setSession } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { AppError, errorMessage } from "@/lib/errors";
import { slugify } from "@/lib/slug";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  password: z.string().min(10).max(200),
  organization: z.string().trim().min(2).max(80),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export async function register(formData: FormData) {
  if (process.env.ALLOW_REGISTRATION === "false") redirect("/register?error=Registration+is+closed.");
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    organization: formData.get("organization"),
  });
  if (!parsed.success) redirect(`/register?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the form.")}`);
  try {
    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError("An account with that email already exists.");
    const passwordHash = await hash(parsed.data.password, 12);
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email,
        passwordHash,
        memberships: {
          create: {
            role: "OWNER",
            organization: { create: { name: parsed.data.organization, slug: `${slugify(parsed.data.organization)}-${Date.now().toString(36)}` } },
          },
        },
      },
      include: { memberships: true },
    });
    await setSession({ sub: user.id, email: user.email, name: user.name, organizationId: user.memberships[0]?.organizationId });
  } catch (error) {
    redirect(`/register?error=${encodeURIComponent(errorMessage(error))}`);
  }
  redirect("/dashboard");
}

export async function login(formData: FormData) {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) redirect("/login?error=Enter+a+valid+email+and+password.");
  let destination = "/dashboard";
  try {
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
      include: { memberships: { orderBy: { createdAt: "asc" }, take: 2 } },
    });
    const valid = user ? await compare(parsed.data.password, user.passwordHash) : false;
    if (!user || !valid) throw new AppError("Email or password is incorrect.");
    const organizationId = user.memberships.length === 1 ? user.memberships[0]?.organizationId : undefined;
    await setSession({ sub: user.id, email: user.email, name: user.name, organizationId });
    destination = user.memberships.length > 1 ? "/organizations" : "/dashboard";
  } catch (error) {
    redirect(`/login?error=${encodeURIComponent(errorMessage(error))}`);
  }
  redirect(destination);
}

export async function logout() {
  await clearSession();
  redirect("/");
}
