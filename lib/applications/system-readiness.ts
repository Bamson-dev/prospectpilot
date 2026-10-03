import { prisma } from "@/lib/db";

export type ReadinessItem = {
  id: string;
  name: string;
  status: "READY" | "NOT_READY";
  type: "REQUIRED" | "RECOMMENDED" | "OPTIONAL";
  link: string;
};

export type SystemReadiness = {
  account: {
    status: "READY" | "NOT_READY";
    items: ReadinessItem[];
  };
  career: {
    status: "READY" | "NOT_READY";
    items: ReadinessItem[];
  };
  preferences: {
    status: "READY" | "NOT_READY";
    items: ReadinessItem[];
  };
  gmail: {
    status: "NOT_CONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";
  };
  subsystems: {
    discovery: "READY" | "NOT_READY";
    qualification: "READY" | "NOT_READY";
    candidate: "READY" | "NOT_READY";
    documentGeneration: "READY" | "NOT_READY";
    applicationPreparation: "READY" | "NOT_READY";
    browserAutomation: "READY" | "NOT_READY";
    submissionEngine: "READY" | "NOT_READY";
    submissionVerification: "READY" | "NOT_READY";
    gmail: "CONNECTED" | "NOT_CONNECTED";
    outboundEmail: "DISABLED" | "ENABLED";
    liveApplicationSubmission: "DISABLED" | "ENABLED";
  };
  readyToActivate: boolean;
};

export async function evaluateSystemReadiness(organizationId: string): Promise<SystemReadiness> {
  const candidate = await prisma.candidate.findFirst({
    where: { organizationId },
    include: {
      preference: true,
      baseDocuments: { where: { kind: "BASE_CV" } },
      experiences: { take: 1 },
      education: { take: 1 }
    }
  });

  const emailAccounts = await prisma.emailAccount.findMany({
    where: { organizationId, provider: "GMAIL" },
    take: 1
  });

  const accountItems: ReadinessItem[] = [];
  const careerItems: ReadinessItem[] = [];
  const preferenceItems: ReadinessItem[] = [];

  if (candidate) {
    // Account
    accountItems.push({
      id: "name", name: "Candidate Name", 
      status: candidate.fullName && candidate.fullName.length > 2 ? "READY" : "NOT_READY", 
      type: "REQUIRED", link: "/jobs/candidate"
    });
    accountItems.push({
      id: "email", name: "Email Address", 
      status: candidate.email && candidate.email.length > 2 ? "READY" : "NOT_READY", 
      type: "REQUIRED", link: "/jobs/candidate"
    });
    accountItems.push({
      id: "phone", name: "Phone Number", 
      status: candidate.phone ? "READY" : "NOT_READY", 
      type: "REQUIRED", link: "/jobs/candidate"
    });
    accountItems.push({
      id: "location", name: "Location", 
      status: candidate.location ? "READY" : "NOT_READY", 
      type: "REQUIRED", link: "/jobs/candidate"
    });
    accountItems.push({
      id: "workAuth", name: "Work Authorization", 
      status: candidate.workAuthorization ? "READY" : "NOT_READY", 
      type: "REQUIRED", link: "/jobs/candidate/answers"
    });
    accountItems.push({
      id: "linkedin", name: "LinkedIn URL", 
      status: candidate.linkedinUrl ? "READY" : "NOT_READY", 
      type: "RECOMMENDED", link: "/jobs/candidate"
    });
    accountItems.push({
      id: "portfolio", name: "Portfolio URL", 
      status: candidate.portfolioUrl ? "READY" : "NOT_READY", 
      type: "OPTIONAL", link: "/jobs/candidate"
    });

    // Career
    careerItems.push({
      id: "baseCv", name: "Base CV Uploaded", 
      status: candidate.baseDocuments && candidate.baseDocuments.length > 0 ? "READY" : "NOT_READY", 
      type: "REQUIRED", link: "/jobs/cv-library"
    });
    careerItems.push({
      id: "experience", name: "Employment History", 
      status: candidate.experiences && candidate.experiences.length > 0 ? "READY" : "NOT_READY", 
      type: "RECOMMENDED", link: "/jobs/candidate/evidence"
    });
    careerItems.push({
      id: "education", name: "Education", 
      status: candidate.education && candidate.education.length > 0 ? "READY" : "NOT_READY", 
      type: "RECOMMENDED", link: "/jobs/candidate"
    });

    // Preferences
    preferenceItems.push({
      id: "targetRoles", name: "Target Roles", 
      status: candidate.targetRoles && candidate.targetRoles.length > 0 ? "READY" : "NOT_READY", 
      type: "REQUIRED", link: "/jobs/candidate"
    });
    preferenceItems.push({
      id: "remotePreference", name: "Remote Preference", 
      status: candidate.remotePreference ? "READY" : "NOT_READY", 
      type: "REQUIRED", link: "/jobs/candidate"
    });
    preferenceItems.push({
      id: "sponsorship", name: "Sponsorship Requirement", 
      status: candidate.sponsorship ? "READY" : "NOT_READY", 
      type: "REQUIRED", link: "/jobs/candidate/answers"
    });
    preferenceItems.push({
      id: "noticePeriod", name: "Notice Period", 
      status: candidate.noticePeriod ? "READY" : "NOT_READY", 
      type: "RECOMMENDED", link: "/jobs/candidate/answers"
    });
  } else {
    // If no candidate exists, everything is NOT_READY
    accountItems.push({ id: "profile", name: "Candidate Profile", status: "NOT_READY", type: "REQUIRED", link: "/jobs/candidate" });
    careerItems.push({ id: "career", name: "Career Details", status: "NOT_READY", type: "REQUIRED", link: "/jobs/candidate" });
    preferenceItems.push({ id: "preferences", name: "Job Preferences", status: "NOT_READY", type: "REQUIRED", link: "/jobs/candidate" });
  }

  const accountStatus = accountItems.every(i => i.type !== "REQUIRED" || i.status === "READY") ? "READY" : "NOT_READY";
  const careerStatus = careerItems.every(i => i.type !== "REQUIRED" || i.status === "READY") ? "READY" : "NOT_READY";
  const preferenceStatus = preferenceItems.every(i => i.type !== "REQUIRED" || i.status === "READY") ? "READY" : "NOT_READY";
  
  const readyToActivate = accountStatus === "READY" && careerStatus === "READY" && preferenceStatus === "READY";

  const gmailStatus = emailAccounts.length > 0 ? "CONNECTED" : "NOT_CONNECTED";

  return {
    account: { status: accountStatus, items: accountItems },
    career: { status: careerStatus, items: careerItems },
    preferences: { status: preferenceStatus, items: preferenceItems },
    gmail: { status: gmailStatus },
    subsystems: {
      discovery: "READY",
      qualification: "READY",
      candidate: readyToActivate ? "READY" : "NOT_READY",
      documentGeneration: "READY",
      applicationPreparation: "READY",
      browserAutomation: "READY",
      submissionEngine: "READY",
      submissionVerification: "READY",
      gmail: gmailStatus,
      outboundEmail: "DISABLED",
      liveApplicationSubmission: process.env.APPLICATION_LIVE_SUBMIT === "true" ? "ENABLED" : "DISABLED",
    },
    readyToActivate
  };
}
