"use server";

import { prisma } from "@/lib/db";
import { getRedis } from "@/lib/queues";
import { ResendProvider } from "@/lib/email/resend";
import { randomBytes } from "crypto";
import { hash } from "bcryptjs";

export async function requestPasswordReset(formData: FormData) {
  const email = formData.get("email");
  if (!email || typeof email !== "string") {
    return { error: "Invalid email." };
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user) {
    // For security reasons, don't reveal if user exists, but we can return success
    return { success: true };
  }

  const token = randomBytes(32).toString("hex");
  
  // Store token in Redis, expires in 15 minutes
  await getRedis().setex(`reset:token:${token}`, 900, user.id);

  const resetLink = `${process.env.NEXT_PUBLIC_APP_URL || 'https://leadpilot.live'}/recover/${token}`;
  
  try {
    const resend = new ResendProvider();
    await resend.sendEmail({
      to: user.email,
      from: "security@leadpilot.live",
      fromName: "ProspectPilot Security",
      subject: "Password Reset Request",
      text: `You requested a password reset. Click this link to reset your password (expires in 15 minutes):\n\n${resetLink}`,
    });
  } catch (err) {
    console.error("Failed to send reset email", err);
    return { error: "Failed to send reset email. Please try again." };
  }

  return { success: true };
}

export async function resetPassword(formData: FormData) {
  const token = formData.get("token");
  const password = formData.get("password");

  if (!token || typeof token !== "string" || !password || typeof password !== "string" || password.length < 8) {
    return { error: "Invalid input or password too short (min 8 chars)." };
  }

  const userId = await getRedis().get(`reset:token:${token}`);
  if (!userId) {
    return { error: "Invalid or expired reset token." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { error: "User no longer exists." };
  }

  const passwordHash = await hash(password, 12);
  
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  // Token must become invalid after successful use
  await getRedis().del(`reset:token:${token}`);

  return { success: true };
}
