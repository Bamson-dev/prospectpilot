import { prisma } from "@/lib/db";
import { logInfo } from "@/lib/logger";
import { applicationAutomationEnabled, applicationMode, jobDiscoveryEnabled } from "@/lib/applications/config";
import { searchPublicJobs } from "@/lib/applications/discover";
import { prepareApplication, storeDiscoveredJobs } from "@/lib/applications/service";
import { statusAfterBlock } from "@/lib/applications/state";

export async function processJobDiscovery(organizationId: string, query: string) {
  if (!jobDiscoveryEnabled()) {
    logInfo("job_discovery.disabled", { organizationId });
    return;
  }
  const jobs = await searchPublicJobs(query);
  const stored = await storeDiscoveredJobs(organizationId, jobs);
  logInfo("job_discovery.stored", { organizationId, count: stored.length });
}

export async function processApplicationPreparation(organizationId: string, vacancyId: string) {
  await prepareApplication(organizationId, vacancyId);
}

export async function processApplicationSubmit(applicationId: string) {
  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
  if (!application) return;
  if (!applicationAutomationEnabled() || applicationMode() !== "AUTO_SUBMIT") {
    await prisma.jobApplication.update({
      where: { id: application.id },
      data: { status: "READY_FOR_REVIEW", blockedReason: "Automatic submission is disabled." },
    });
    await prisma.applicationEvent.create({
      data: { applicationId: application.id, type: "MANUAL_ACTION_REQUIRED", detail: "Automatic submission is disabled." },
    });
    return;
  }
  await prisma.jobApplication.update({
    where: { id: application.id },
    data: { status: statusAfterBlock("captcha"), blockedReason: "Live submission stays off until a supported adapter run is explicitly started." },
  });
  await prisma.applicationEvent.create({
    data: { applicationId: application.id, type: "MANUAL_ACTION_REQUIRED", detail: "Live submission was not started." },
  });
}

export async function processApplicationFollowUp(organizationId: string) {
  const due = await prisma.applicationFollowUp.findMany({
    where: { status: "DRAFT", runAt: { lte: new Date() }, application: { organizationId } },
    take: 20,
  });
  logInfo("application.followups_waiting", { organizationId, count: due.length });
}
