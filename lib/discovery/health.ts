import { prisma } from "@/lib/db";

export async function recordSourceHealth(name: string, outcome: "success" | "failure" | "blocked" | "empty", detail?: string) {
  const failed = outcome === "failure" || outcome === "blocked";
  await prisma.sourceHealth.upsert({
    where: { name },
    create: {
      name,
      status: outcome === "success" ? "healthy" : outcome === "empty" ? "empty" : "error",
      requests: 1,
      successes: outcome === "success" ? 1 : 0,
      failures: failed ? 1 : 0,
      blocked: outcome === "blocked" ? 1 : 0,
      emptyResults: outcome === "empty" ? 1 : 0,
      lastError: failed ? detail?.slice(0, 300) ?? null : null,
      lastSuccessAt: outcome === "success" ? new Date() : null,
    },
    update: {
      requests: { increment: 1 },
      successes: outcome === "success" ? { increment: 1 } : undefined,
      failures: failed ? { increment: 1 } : undefined,
      blocked: outcome === "blocked" ? { increment: 1 } : undefined,
      emptyResults: outcome === "empty" ? { increment: 1 } : undefined,
      status: outcome === "success" ? "healthy" : outcome === "empty" ? "empty" : "error",
      lastError: failed ? detail?.slice(0, 300) ?? null : undefined,
      lastSuccessAt: outcome === "success" ? new Date() : undefined,
    },
  });
}
