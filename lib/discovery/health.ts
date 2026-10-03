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

export async function isApplicationAccessible(urlStr: string, ats?: string): Promise<boolean> {
  try {
    const url = new URL(urlStr);
    const domain = url.hostname;
    
    // Check URL level
    const urlHealth = await prisma.sourceHealth.findUnique({ where: { name: `app-url:${urlStr.slice(0, 200)}` } });
    if (urlHealth) {
      if (urlHealth.blocked > 0 && urlHealth.successes === 0) return false;
      const total = urlHealth.successes + urlHealth.failures + urlHealth.blocked;
      if (total >= 3 && urlHealth.blocked / total >= 0.5) return false;
    }

    // Check Domain level
    const domainHealth = await prisma.sourceHealth.findUnique({ where: { name: `app-domain:${domain}` } });
    if (domainHealth) {
      if (domainHealth.blocked > 0 && domainHealth.successes === 0) return false;
      const total = domainHealth.successes + domainHealth.failures + domainHealth.blocked;
      if (total >= 3 && domainHealth.blocked / total >= 0.5) return false;
    }

    // ATS level acts as a baseline but shouldn't override a good domain
    // We only use ATS level if it's exceptionally bad AND we have no domain data
    if (ats && !domainHealth && !urlHealth) {
      const atsHealth = await prisma.sourceHealth.findUnique({ where: { name: `app-ats:${ats}` } });
      if (atsHealth) {
        const total = atsHealth.successes + atsHealth.failures + atsHealth.blocked;
        // Require more evidence to blacklist an entire ATS (e.g., 10 attempts)
        if (total >= 10 && atsHealth.blocked / total >= 0.9) return false;
      }
    }
    
    return true;
  } catch (e) {
    return true; // invalid url, let downstream handle it
  }
}

