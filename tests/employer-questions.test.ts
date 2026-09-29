import { describe, expect, it } from "vitest";
import { applicationReadinessReport } from "@/lib/applications/application-readiness";
import { factReplacement } from "@/lib/applications/candidate-fields";
import { explicitTechnologyDuration, judgeField, resolveFieldAnswer } from "@/lib/applications/field-taxonomy";
import { answerQuestion } from "@/lib/applications/questions";
import { seedCandidateRecord } from "@/lib/applications/seed-data";
import { assessWriting, humanRewrite } from "@/lib/applications/writing-quality";
import type { FitResult } from "@/lib/applications/fit";
import type { JobInput } from "@/lib/applications/types";

const job: JobInput = {
  title: "Software Engineer",
  companyName: "Northwind",
  description: "Build product features.",
  applicationUrl: "https://example.com/jobs/1",
};

describe("employer questions", () => {
  it("classifies common employer questions without guessing an option", () => {
    expect(judgeField({ label: "Are you legally authorized to work in the United States?" }).taxonomy).toBe("WORK_AUTHORIZATION");
    expect(judgeField({ label: "Will you now or in the future require sponsorship?" }).taxonomy).toBe("SPONSORSHIP");
    expect(judgeField({ label: "What are your salary expectations?" }).taxonomy).toBe("SALARY_EXPECTATION");
    expect(judgeField({ label: "Are you willing to relocate?" }).taxonomy).toBe("RELOCATION");
    expect(judgeField({ label: "Are you currently employed?" }).taxonomy).toBe("EMPLOYMENT_STATUS");
    expect(judgeField({ label: "When can you start?" }).taxonomy).toBe("START_DATE");
    expect(judgeField({ label: "Are you comfortable working remotely?" }).taxonomy).toBe("REMOTE_ELIGIBILITY");
    expect(judgeField({ label: "Have you used AI tools in your work?" }).taxonomy).toBe("AI_USAGE");
    expect(judgeField({ label: "Do you agree to the privacy policy?" }).taxonomy).toBe("PRIVACY_CONSENT");
    expect(judgeField({ label: "Airbnb Candidate Privacy Policy" }).confidence).toBeGreaterThanOrEqual(0.85);
    const interest = judgeField({ label: "Why are you interested in this role?" });
    expect(interest.taxonomy).toBe("CUSTOM_QUESTION");
    expect(interest.confidence).toBeGreaterThanOrEqual(0.85);

    const sponsorship = resolveFieldAnswer({
      judgment: judgeField({ label: "Will you now or in the future require sponsorship?" }),
      required: true,
      options: ["I require sponsorship", "I do not require sponsorship"],
      values: { sponsorship: "No" },
    });
    expect(sponsorship.status).toBe("REVIEW_REQUIRED");
    expect(sponsorship.reason).toBe("no matching option");

    const exact = resolveFieldAnswer({
      judgment: judgeField({ label: "Will you now or in the future require sponsorship?" }),
      required: true,
      options: ["I require sponsorship", "I do not require sponsorship"],
      values: { sponsorship: "I do not require sponsorship" },
    });
    expect(exact.status).toBe("ANSWERED");
    expect(exact.value).toBe("I do not require sponsorship");

    const consent = resolveFieldAnswer({
      judgment: judgeField({ label: "Do you agree to the privacy policy?" }),
      required: true,
      options: ["Yes", "No"],
      values: { privacy: "Yes" },
    });
    expect(consent.status).toBe("REVIEW_REQUIRED");
    expect(consent.reason).toBe("employer-specific question needs review");

    const bands = resolveFieldAnswer({
      judgment: judgeField({ label: "What are your salary expectations?" }),
      required: true,
      options: ["Under 100000", "100000 to 150000", "Over 150000"],
      values: { salary: "120000 USD per year" },
    });
    expect(bands.status).toBe("REVIEW_REQUIRED");
  });

  it("uses an explicit duration and does not borrow years from another technology", () => {
    expect(explicitTechnologyDuration("3 years of TypeScript experience", "typescript")).toBe("3");
    expect(explicitTechnologyDuration("Uses TypeScript", "typescript")).toBeNull();
    expect(explicitTechnologyDuration("3 years of Next.js", "node.js")).toBeNull();
    expect(explicitTechnologyDuration("3 years of Next.js and Node.js", "node.js")).toBeNull();
    const person = seedCandidateRecord();
    person.facts.push({
      id: "duration",
      category: "EXPERIENCE",
      fact: "3 years of TypeScript experience",
      sourceType: "CANDIDATE_ENTERED",
      verified: true,
      profiles: ["SOFTWARE"],
    });
    const fit = { strongEvidence: [], selectedProjects: [], missingRequirements: [], uncertain: [] } as unknown as FitResult;
    expect(answerQuestion("How many years of experience do you have with TypeScript?", job, person, fit).status).toBe("ANSWERED");
    expect(answerQuestion("How many years of experience do you have with Node.js?", job, person, fit).status).toBe("REVIEW_REQUIRED");
    const plain = seedCandidateRecord();
    expect(answerQuestion("How many years of experience do you have with TypeScript?", job, plain, fit).answer).toBeNull();
  });

  it("does not mark an application ready because a form was opened", () => {
    const blocked = applicationReadinessReport({
      candidateName: "Bamidele Matthew",
      jobTitle: "Software Engineer",
      cvReady: true,
      coverLetterReady: true,
      contactReady: true,
      workAuthorization: "On file",
      sponsorship: "No sponsorship is required.",
      formOpened: true,
      captcha: true,
    });
    expect(blocked.decision).toBe("HARD_BLOCKED");
    expect(blocked.reasons.some((reason) => reason.startsWith("BLOCKED: CAPTCHA"))).toBe(true);
    const opened = applicationReadinessReport({
      candidateName: "Bamidele Matthew",
      jobTitle: "Software Engineer",
      cvReady: true,
      coverLetterReady: true,
      contactReady: true,
      formOpened: true,
    });
    expect(opened.decision).toBe("REVIEW_REQUIRED");
    expect(opened.decision).not.toBe("READY");
  });

  it("ignores harmless repetition and still rejects an unsupported claim", () => {
    const harmless = assessWriting({
      text: "I am applying for the role. The web application and a worker are both part of ProspectPilot. Another web application and a worker note stays specific.",
    });
    expect(harmless.repeated_phrase_count).toBe(0);
    expect(harmless.status).toBe("PASS");
    const repeated = assessWriting({
      text: "ProspectPilot stores verified candidate evidence. ProspectPilot stores verified candidate evidence.",
    });
    expect(repeated.status).toBe("REVIEW_REQUIRED");
    expect(repeated.repeated_phrase_count).toBeGreaterThan(0);
    const once = assessWriting({ text: "I am interested in the role and the work already on file." });
    expect(once.status).toBe("PASS");
    const rewritten = humanRewrite("I am excited to apply. I used the verified TypeScript work.");
    expect(rewritten).not.toMatch(/\u2014/);
    expect(rewritten).not.toContain("AWS");
    expect(factReplacement("Salary expectation: 100", "Salary expectation: 120")).toBe("replace");
    expect(factReplacement("Salary expectation: 100", "Salary expectation: 100")).toBe("keep");
    expect(factReplacement(null, "Salary expectation: 100")).toBe("create");
  });
});
