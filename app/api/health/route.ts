import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { healthDecision } from "@/lib/health";
import { getRedis } from "@/lib/queues";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ready = new URL(request.url).searchParams.get("ready") === "1";
  let database: "up" | "down" = "down";
  let redis: "up" | "down" | "unconfigured" = process.env.REDIS_URL ? "down" : "unconfigured";
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
  const decision = healthDecision(database, redis, ready);
  
  const diagnostics = {
    gitSha: process.env.COOLIFY_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
    hasDeepSeek: !!process.env.DEEPSEEK_API_KEY,
  };
  
  return NextResponse.json({ ...decision.body, diagnostics }, { status: decision.status, headers: { "Cache-Control": "no-store" } });
}
