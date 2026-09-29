import { describe, expect, it } from "vitest";
import { applicationReadinessReport } from "@/lib/applications/application-readiness";
import { classifyBlockers } from "@/lib/applications/blockers";
import { candidateReadiness } from "@/lib/applications/readiness";
import { evidenceLibrary } from "@/lib/applications/evidence-library";
import { selectEvidence } from "@/lib/applications/evidence-selection";
import { nextPackageVersion, preparationDecision, safeAuditDetail } from "@/lib/applications/package-version";
import { assessWriting, humanRewrite } from "@/lib/applications/writing-quality";
import { scoreJobFit } from "@/lib/applications/fit";
import { seedCandidateRecord } from "@/lib/applications/seed-data";
import type { JobInput } from "@/lib/applications/types";

const job: JobInput = {
  title: "Software Engineer",
  companyName: "Northwind",
  description: "Build product features with TypeScript.",
  applicationUrl: "https://boards.greenhouse.io/northwind/jobs/1",
};

describe("candidate intelligence", () => {
  it("shows which missing fields block a CV", () => {
    const readiness = candidateReadiness({ email: "person@example.com" });
    expect(readiness.cvStatus).toBe("READY");
    expect(readiness.fields.find((field) => field.field === "salary expectation")?.purpose).toBe("OPTIONAL");
    expect(readiness.fields.find((field) => field.field === "work authorization")?.purpose).toBe("APPLICATION");
    expect(readiness.status).toBe("INCOMPLETE");
  });

  it("keeps generated text out of the evidence library and does not invent Node.js", () => {
    const items = evidenceLibrary({
      facts: [
        { category: "TECHNOLOGY", fact: "TypeScript", source: "ProspectPilot repository", sourceType: "REPOSITORY_VERIFIED", verified: true, profiles: ["SOFTWARE", "WEB"] },
        { category: "EXPERIENCE", fact: "Generated a CV sentence.", source: "generator", sourceType: "SYSTEM_GENERATED", verified: true, profiles: ["SOFTWARE"] },
        { category: "SKILL", fact: "Unverified skill", source: "note", sourceType: "CANDIDATE_ENTERED", verified: false },
      ],
    });
    expect(items.map((item) => item.value)).toEqual(["TypeScript"]);
    expect(items[0]?.usableFor).toContain("Software");
    const node = selectEvidence("Node.js", [{ fact: "Next.js application", technologies: ["Next.js"], source: "ProspectPilot repository" }]);
    expect(node.match).toBe("MISSING");
    const typescript = selectEvidence("TypeScript", [{ fact: "TypeScript services", technologies: ["TypeScript"], source: "ProspectPilot repository" }]);
    expect(typescript.match).toBe("DIRECT");
    expect(typescript.source).toBe("ProspectPilot repository");
    const years = selectEvidence("5 years of TypeScript", [{ fact: "TypeScript services", technologies: ["TypeScript"] }]);
    expect(years.match).toBe("UNCERTAIN");
  });

  it("classifies blockers and readiness without treating missing salary as a hard stop", () => {
    const blockers = classifyBlockers({ captcha: true, salaryAsked: false, salaryKnown: false, linkedinKnown: false, workAuthorizationAsked: true, workAuthorizationKnown: false });
    expect(blockers.find((item) => item.label === "CAPTCHA")?.class).toBe("HARD_BLOCKER");
    expect(blockers.find((item) => item.label === "Work authorization")?.class).toBe("REVIEW_REQUIRED");
    expect(blockers.find((item) => item.label === "Salary")?.class).toBe("OPTIONAL");
    expect(blockers.find((item) => item.label === "LinkedIn")?.class).toBe("OPTIONAL");
    const report = applicationReadinessReport({
      candidateName: "Bamidele Matthew",
      jobTitle: "Software Engineer",
      cvReady: true,
      coverLetterReady: true,
      contactReady: false,
      captcha: true,
      reviewQuestions: 2,
    });
    expect(report.overall).toBe("REQUIRES_MANUAL_ACTION");
    expect(report.captcha).toBe("DETECTED");
    expect(report.requiredQuestions).toBe(2);
  });

  it("versions packages, avoids duplicate preparation, and redacts secrets from the audit log", () => {
    expect(preparationDecision(false, false)).toBe("CREATE");
    expect(preparationDecision(true, false)).toBe("REUSE");
    expect(preparationDecision(true, true)).toBe("REPREPARE");
    expect(nextPackageVersion(2)).toBe(3);
    expect(safeAuditDetail("Approved. Bearer abc.token=secret")).toBe("redacted");
    expect(safeAuditDetail("Package v2")).toBe("Package v2");
  });

  it("rejects generic writing and does not add facts during a rewrite", () => {
    const generic = assessWriting({ text: "I am excited to apply. I am a results-driven professional.", jobDescription: "Build APIs." });
    expect(generic.status).toBe("REVIEW_REQUIRED");
    expect(generic.generic_phrase_count).toBeGreaterThan(0);
    const copied = assessWriting({
      text: "You will own the affiliate acquisition program across paid and partner channels.",
      jobDescription: "You will own the affiliate acquisition program across paid and partner channels.",
    });
    expect(copied.job_description_overlap).toBe(1);
    expect(copied.status).toBe("REVIEW_REQUIRED");
    const rewritten = humanRewrite("I am excited to apply for the role. I used TypeScript.");
    expect(rewritten.toLowerCase()).not.toContain("excited to apply");
    expect(rewritten).not.toContain("AWS");
    expect(rewritten).not.toMatch(/\u2014/);
    const natural = assessWriting({ text: "I am applying for the Software Engineer role at Northwind. The TypeScript work is in ProspectPilot.", recentOpenings: ["Hello there."] });
    expect(natural.status).toBe("PASS");
    expect(natural.unsupported_claim_count).toBe(0);
  });

  it("selects verified evidence for the vacancy and leaves Node.js missing", () => {
    const person = seedCandidateRecord();
    const fit = scoreJobFit(job, person, [{ kind: "TECHNOLOGY", text: "TypeScript", required: true }, { kind: "TECHNOLOGY", text: "Node.js", required: true }]);
    expect(fit.selections.find((item) => item.requirement === "Node.js")?.match).toBe("MISSING");
    expect(fit.selections.find((item) => item.requirement === "TypeScript")?.match).toBe("DIRECT");
  });
});
