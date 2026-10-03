import { describe, expect, it } from "vitest";
import { validateCvFacts } from "@/lib/applications/claims";
import { factReplacement } from "@/lib/applications/candidate-fields";
import { buildCoverLetter } from "@/lib/applications/cover-letter";
import { buildCvDraft } from "@/lib/applications/cv";
import { evidenceLibrary, supportsClaim, usableEvidence } from "@/lib/applications/evidence-library";
import { selectEvidence } from "@/lib/applications/evidence-selection";
import { scoreJobFit } from "@/lib/applications/fit";
import { assemblePackage } from "@/lib/applications/package";
import { safeAuditDetail } from "@/lib/applications/package-version";
import { allowedAnswerSource, answerQuestion, customQuestionRecord } from "@/lib/applications/questions";
import { applicationCriticalFields } from "@/lib/applications/readiness";
import { detectSecurityBarrier } from "@/lib/applications/security";
import { seedCandidateRecord } from "@/lib/applications/seed-data";
import { automaticSubmissionAllowed, canTransition, pipelineState } from "@/lib/applications/state";
import { planApplication } from "@/lib/applications/browser-plan";
import { assessWriting, humanRewrite } from "@/lib/applications/writing-quality";
import { extractRequirements } from "@/lib/applications/requirements";
import type { JobInput } from "@/lib/applications/types";

const job: JobInput = {
  title: "Software Engineer",
  companyName: "Northwind",
  description: "Build web applications with TypeScript.\nAWS experience is preferred.\nAre you authorized to work in the United States?",
  applicationUrl: "https://job-boards.greenhouse.io/embed/job_app?for=northwind&token=1",
};

describe("evidence-backed preparation", () => {
  it("labels critical candidate data without inferring it", () => {
    const fields = applicationCriticalFields({ fullName: "Bamidele Matthew", email: "needs-email@invalid.test" });
    expect(fields.find((field) => field.label === "Full name")?.availability).toBe("AVAILABLE");
    expect(fields.find((field) => field.label === "Email")?.availability).toBe("REVIEW REQUIRED");
    expect(fields.find((field) => field.label === "Work authorization")?.availability).toBe("MISSING");
    expect(fields.find((field) => field.label === "Sponsorship")?.availability).toBe("MISSING");
    expect(fields.find((field) => field.label === "Salary")?.availability).toBe("MISSING");
    expect(factReplacement("Work authorization: Yes", "Work authorization: Yes")).toBe("keep");
    expect(factReplacement("Work authorization: Yes", "Work authorization: No")).toBe("replace");
    expect(factReplacement(null, "Work authorization: Yes")).toBe("create");
  });

  it("keeps generated documents out of evidence and explains a missing technology", () => {
    expect(usableEvidence({ verified: true, sourceType: "SYSTEM_GENERATED", source: "generated-cv", fact: "Invented AWS." })).toBe(false);
    expect(usableEvidence({ verified: true, sourceType: "CANDIDATE_ENTERED", source: "generated-cover-letter", fact: "Invented metric." })).toBe(false);
    const items = evidenceLibrary({
      facts: [
        { category: "TECHNOLOGY", fact: "TypeScript", source: "candidate-settings", sourceType: "CANDIDATE_ENTERED", verified: true },
        { category: "EXPERIENCE", fact: "Generated a CV sentence.", source: "generated-cv", sourceType: "CANDIDATE_ENTERED", verified: true },
      ],
    });
    expect(items.map((item) => item.value)).toEqual(["TypeScript"]);
    expect(items[0]?.origin).toBe("CANDIDATE_ENTERED");
    expect(supportsClaim("TypeScript", items)?.value).toBe("TypeScript");
    expect(supportsClaim("Node.js", items)).toBeNull();
    const node = selectEvidence("Node.js experience", [{ fact: "Next.js application", technologies: ["Next.js"], source: "repository" }]);
    expect(node.match).toBe("MISSING");
    expect(node.evidence).toBeNull();
    expect(node.reason).toMatch(/not treated as the same skill/);
    const explained = selectEvidence("product work", [{ fact: "This experience is transferable to product work.", category: "EXPERIENCE", source: "candidate" }]);
    expect(explained.match).toBe("TRANSFERABLE");
    expect(explained.reason).toMatch(/transferable to product work/i);
  });

  it("builds a vacancy-specific CV and flags unsupported claims", () => {
    const person = { ...seedCandidateRecord(), email: "local-review-only@example.com" };
    const fit = scoreJobFit(job, person, extractRequirements(job.description));
    const cv = buildCvDraft(job, person, fit);
    expect(cv.text.toLowerCase()).not.toContain("aws");
    expect(cv.text.toLowerCase()).not.toContain("node.js");
    const bad = validateCvFacts("I worked as Principal Engineer. I have 9 years of Rust and improved revenue by 40%. AWS Certified.", person, [job.companyName]);
    expect(bad.status).toBe("REVIEW_REQUIRED");
    expect(bad.issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining(["job title", "duration", "technology", "metric", "certification"]));
    const clean = validateCvFacts(cv.text, person, [job.companyName, job.title]);
    expect(clean.status).toBe("PASS");
  });

  it("keeps ordinary cover-letter language and rejects an invented claim", () => {
    const person = { ...seedCandidateRecord(), email: "local-review-only@example.com" };
    const fit = scoreJobFit(job, person, extractRequirements(job.description));
    const letter = buildCoverLetter(job, person, fit);
    expect(letter).not.toContain("—");
    expect(assessWriting({ text: "I am interested in the role. The verified work is on file.", jobDescription: job.description }).status).toBe("PASS");
    expect(humanRewrite("I am excited to apply — and I used AWS.").includes("—")).toBe(false);
    const repeated = assessWriting({ text: "ProspectPilot stores verified candidate evidence. ProspectPilot stores verified candidate evidence." });
    expect(repeated.status).toBe("REVIEW_REQUIRED");
  });

  it("answers only from entered or verified data", () => {
    const person = seedCandidateRecord();
    const fit = scoreJobFit(job, person, extractRequirements(job.description));
    const authorization = answerQuestion("Are you authorized to work in the United States?", job, person, fit);
    const sponsorship = answerQuestion("Will you require sponsorship?", job, person, fit);
    const salary = answerQuestion("What are your salary expectations?", job, person, fit);
    const years = answerQuestion("How many years of TypeScript experience do you have?", job, person, fit);
    const custom = customQuestionRecord({ question: "Why are you interested in this role?", required: true, options: ["Yes", "No"], fieldType: "select" });
    const sensitive = answerQuestion("What is your gender?", job, person, fit);
    for (const answer of [authorization, sponsorship, salary, years, custom, sensitive]) {
      expect(answer.reviewState).toBe("REVIEW_REQUIRED");
      expect(answer.answer).toBeNull();
      expect(answer.source).toBe("HUMAN_REVIEW");
      expect(allowedAnswerSource(answer.source)).toBe(true);
    }
    expect(allowedAnswerSource("MODEL_GUESS")).toBe(false);
    const withDuration = {
      ...person,
      facts: [...person.facts, { id: "ts-years", category: "TECHNOLOGY" as const, fact: "3 years of TypeScript experience", verified: true, profiles: [], sourceType: "CANDIDATE_ENTERED" as const }],
    };
    const answered = answerQuestion("How many years of experience do you have with TypeScript?", job, withDuration, fit);
    expect(answered.answer).toBe("3 years");
    expect(answered.source).toBe("VERIFIED_EVIDENCE");
    const choice = customQuestionRecord({ question: "Are you comfortable working remotely?", options: ["Remote", "Hybrid", "On-site"], answer: "Remote", source: "CANDIDATE_ENTERED" });
    expect(choice.answer).toBe("Remote");
    expect(choice.source).toBe("CANDIDATE_ENTERED");
  });

  it("versions a package, blocks automatic submission, and redacts secrets", () => {
    const person = { ...seedCandidateRecord(), email: "local-review-only@example.com" };
    const pack = assemblePackage(job, person);
    expect(pack.version).toBe(1);
    expect(pack.readiness).toBe("REVIEW_REQUIRED");
    expect(pack.pipeline).toBe("REVIEW_REQUIRED");
    expect(pack.answers.some((answer) => answer.reviewState === "REVIEW_REQUIRED")).toBe(true);
    expect(canTransition("REQUIRES_REVIEW", "SUBMITTED")).toBe(false);
    expect(canTransition("REQUIRES_MANUAL_ACTION", "SUBMITTED")).toBe(false);
    expect(canTransition("REQUIRES_MANUAL_ACTION", "SUBMITTING")).toBe(true);
    expect(automaticSubmissionAllowed()).toBe(false);
    expect(pipelineState("REQUIRES_MANUAL_ACTION")).toBe("REQUIRES_MANUAL_ACTION");
    expect(pipelineState("APPROVED")).toBe("APPROVED");
    expect(safeAuditDetail("cookie: session=abc sitekey=secret")).toBe("redacted");
    expect(safeAuditDetail("g-recaptcha-response hidden")).toBe("redacted");
    expect(detectSecurityBarrier({ text: "Please complete the reCAPTCHA" })).toBe("captcha");
    expect(detectSecurityBarrier({ text: "Checking your browser before Cloudflare" })).toBe("cloudflare");
    expect(detectSecurityBarrier({ text: "Sign in to apply", fieldTypes: ["password"] })).toBe("authentication");
    expect(planApplication({ provider: "greenhouse", mode: "MANUAL", automationEnabled: false, captcha: true, unknownRequired: 1 }).submit).toBe(false);
  });
});
