import { describe, expect, it } from "vitest";
import { keptQualificationExplanation } from "@/lib/applications/application-queue";
import { planApplication } from "@/lib/applications/browser-plan";
import { buildCoverLetter } from "@/lib/applications/cover-letter";
import { acceptCvRewrite, buildCvDraft, cvStorageFailure } from "@/lib/applications/cv";
import { documentFileName } from "@/lib/applications/filenames";
import { fieldsFromHtml, inspectFields, mapCandidateToFields } from "@/lib/applications/form-map";
import { scoreJobFit } from "@/lib/applications/fit";
import { preparationDecision, safeAuditDetail } from "@/lib/applications/package-version";
import { applicationReadinessReport } from "@/lib/applications/application-readiness";
import { classifyCandidateEmail, seedCandidateRecord } from "@/lib/applications/seed-data";
import { classifyNavigationError, classifyObservedBarrier, detectSecurityBarrier, employerServerError, preparationBlocker, preparationReadinessLine } from "@/lib/applications/security";
import { FormattingValidator } from "@/lib/applications/validators";
import { sourceValidity } from "@/lib/applications/source-validity";
import type { JobInput } from "@/lib/applications/types";

const job: JobInput = {
  title: "Staff Product Security Architect",
  companyName: "GitLab",
  description: "Build product security architecture.",
  applicationUrl: "https://job-boards.greenhouse.io/gitlab/jobs/8815140002",
};

describe("preparation runtime blockers", () => {
  it("keeps an individual Greenhouse vacancy and rejects listing pages", () => {
    expect(sourceValidity({ title: job.title, url: job.applicationUrl, source: "greenhouse" })).toBe("VALID_VACANCY");
    expect(sourceValidity({ title: "Careers", url: "https://gitlab.com/careers", source: "generic" })).toBe("INVALID_SOURCE");
    expect(sourceValidity({ title: "Jobs at Spotify", url: "https://jobs.lever.co/spotify", source: "lever" })).toBe("INVALID_SOURCE");
  });

  it("classifies security barriers and employer failures separately", () => {
    expect(detectSecurityBarrier({ text: "Please complete the reCAPTCHA" })).toBe("captcha");
    expect(preparationBlocker("captcha")).toBe("CAPTCHA_REQUIRED");
    expect(detectSecurityBarrier({ text: "Checking your browser before Cloudflare" })).toBe("cloudflare");
    expect(preparationBlocker("cloudflare")).toBe("CLOUDFLARE_CHALLENGE");
    expect(detectSecurityBarrier({ text: "Sign in to apply", fieldTypes: ["password"] })).toBe("authentication");
    expect(preparationBlocker("authentication")).toBe("LOGIN_REQUIRED");
    expect(employerServerError(503, "Error 503 Service Unavailable")).toBe(true);
    expect(employerServerError(200, "Staff Product Security Architect at GitLab")).toBe(false);
    expect(classifyNavigationError('page.goto: Timeout 20000ms exceeded.\nCall log:\n- navigating to "https://job-boards.greenhouse.io/gitlab/jobs/1"')).toBe("PAGE_LOAD_TIMEOUT");
    expect(classifyNavigationError("browserType.launch: Failed to launch")).toBe("BROWSER_TIMEOUT");
    expect(classifyNavigationError("waiting for locator('input')")).toBe("APPLICATION_FORM_NOT_FOUND");
    expect(preparationBlocker("unknown-required-field")).toBe("UNRESOLVED_REQUIRED_FIELD");
    expect(preparationBlocker("pause before submit")).toBeNull();
  });

  it("resolves verified contact fields and leaves sensitive answers for review", () => {
    const fields = fieldsFromHtml(`
      <label for="email">Email</label><input id="email" type="email" required />
      <label for="phone">Phone</label><input id="phone" type="tel" />
      <label for="linkedin">LinkedIn Profile</label><input id="linkedin" />
      <label for="auth">Are you authorized to work in the United States?</label><input id="auth" required />
      <label for="sponsor">Will you require sponsorship?</label><input id="sponsor" required />
      <label for="why">Why do you want to work here?</label><textarea id="why" required></textarea>
    `);
    const mapped = mapCandidateToFields(inspectFields(fields), { email: "bamzonline01@gmail.com", phone: "+1 555 0100", linkedin: "https://www.linkedin.com/in/example" });
    expect(mapped.find((item) => item.name === "email")?.status).toBe("ANSWERED");
    expect(mapped.find((item) => item.name === "phone")?.status).toBe("ANSWERED");
    expect(mapped.find((item) => item.name === "linkedin")?.status).toBe("ANSWERED");
    expect(mapped.find((item) => item.name === "auth")?.status).not.toBe("ANSWERED");
    expect(mapped.find((item) => item.name === "sponsor")?.status).not.toBe("ANSWERED");
    expect(mapped.find((item) => item.name === "why")?.status).not.toBe("ANSWERED");
  });

  it("keeps documents, qualification, and submission separate from a failed preparation", () => {
    const candidate = { ...seedCandidateRecord(), email: "bamzonline01@gmail.com" };
    const fit = scoreJobFit(job, candidate, []);
    const cv = buildCvDraft(job, candidate, fit);
    const letter = buildCoverLetter(job, candidate, fit);
    expect(cv.text).toContain("Bamidele Matthew");
    expect(cv.text).toContain("bamzonline01@gmail.com");
    expect(cv.text).toContain("GitLab");
    expect(cv.text).toContain(job.title);
    expect(letter).toContain("GitLab");
    expect(letter).toContain(job.title);
    expect(letter).not.toContain("\u2014");
    expect(documentFileName({ fullName: candidate.fullName, headline: cv.headline, companyName: job.companyName, extension: "pdf" })).toContain("GitLab");
    expect(planApplication({ provider: "greenhouse", mode: "AUTO_PREPARE", automationEnabled: false, captcha: true, unknownRequired: 1 }).submit).toBe(false);
    expect(keptQualificationExplanation({ explanation: { state: "APPLY" } })?.state).toBe("APPLY");
    expect(preparationDecision(true, false)).toBe("REUSE");
    expect(safeAuditDetail("cookie=session; captcha sitekey=abc")).toBe("redacted");
  });
});

const spotify: JobInput = {
  title: "Principal Product Manager - Personalization",
  companyName: "Spotify",
  description: "Lead personalization for the consumer subscription experience. Prioritize roadmap decisions with research and product partners.",
  applicationUrl: "https://jobs.lever.co/spotify/e74bfb24-55de-4d93-b228-ae38b8fdfbea/apply",
};

describe("document and blocker accuracy", () => {
  it("classifies a real mailbox as valid and keeps placeholders invalid", () => {
    expect(classifyCandidateEmail("bamzonline01@gmail.com")).toBe("VALID_EMAIL");
    expect(classifyCandidateEmail("Bamzonline01@gmail.com")).toBe("VALID_EMAIL");
    expect(classifyCandidateEmail("needs-email@invalid.test")).toBe("PLACEHOLDER_EMAIL");
    expect(classifyCandidateEmail("person@example.invalid")).toBe("PLACEHOLDER_EMAIL");
    expect(classifyCandidateEmail("")).toBe("MISSING_EMAIL");
    expect(classifyCandidateEmail("not-an-email")).toBe("INVALID_EMAIL");
  });

  it("stores a Spotify vacancy CV with standard headings and does not blame a valid email", () => {
    const candidate = { ...seedCandidateRecord(), email: "bamzonline01@gmail.com" };
    const fit = scoreJobFit(spotify, candidate, []);
    const cv = buildCvDraft(spotify, candidate, fit);
    const letter = buildCoverLetter(spotify, candidate, fit);
    expect(FormattingValidator(cv.text).ok).toBe(true);
    expect(cv.text).toContain("Summary");
    expect(cv.text).toContain("Experience");
    expect(cv.text).toContain("Skills");
    expect(cv.text).toContain("Bamidele Matthew");
    expect(cv.text).toContain("bamzonline01@gmail.com");
    expect(cv.text).toContain("Spotify");
    expect(cv.text).toContain(spotify.title);
    expect(cv.text).not.toContain("\u2014");
    expect(cv.text.toLowerCase()).not.toContain("credit drawdown");
    expect(letter).toContain("Spotify");
    expect(letter).toContain(spotify.title);
    expect(acceptCvRewrite({ draft: cv.text, rewritten: cv.text.replace("Skills", "Capabilities"), candidate, companyName: "Spotify", title: spotify.title })).toBe(false);
    const failure = cvStorageFailure("bamzonline01@gmail.com", ["missing standard headings"]);
    expect(failure.error_code).toBe("CV_HEADINGS_MISSING");
    expect(failure.message).toContain("required standard headings are missing");
    expect(failure.message.toLowerCase()).not.toContain("placeholder");
    expect(cvStorageFailure("needs-email@invalid.test", ["missing standard headings"]).error_code).toBe("PLACEHOLDER_EMAIL");
  });

  it("rejects a CV that is missing the required headings", () => {
    const result = FormattingValidator("Bamidele Matthew\nbamzonline01@gmail.com\nA paragraph with no sections.");
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("missing standard headings");
  });

  it("records a specific security barrier and keeps readiness aligned with it", () => {
    expect(classifyObservedBarrier({ text: "Please complete the reCAPTCHA" })).toBe("CAPTCHA_REQUIRED");
    expect(classifyObservedBarrier({ text: "Checking your browser before Cloudflare" })).toBe("CLOUDFLARE_CHALLENGE");
    expect(classifyObservedBarrier({ text: "Sign in to apply", fieldTypes: ["password"] })).toBe("LOGIN_REQUIRED");
    expect(classifyObservedBarrier({ text: "Access denied" })).toBe("ACCESS_DENIED");
    expect(classifyObservedBarrier({ text: "Error 503 Service Unavailable", statusCode: 503 })).toBe("EMPLOYER_SERVER_ERROR");
    expect(preparationBlocker("an unidentified interstitial")).toBe("SECURITY_BLOCK");
    expect(preparationReadinessLine("CAPTCHA_REQUIRED")).toBe("CAPTCHA requires manual action");
    expect(preparationReadinessLine("CAPTCHA_REQUIRED")).not.toContain("not detected");
    const report = applicationReadinessReport({
      candidateName: "Bamidele Matthew",
      jobTitle: spotify.title,
      cvReady: true,
      coverLetterReady: true,
      contactReady: true,
      captcha: true,
    });
    expect(report.captcha).toBe("DETECTED");
    expect(keptQualificationExplanation({ explanation: { state: "APPLY" } })?.state).toBe("APPLY");
    const plan = planApplication({ provider: "lever", mode: "AUTO_PREPARE", automationEnabled: false, captcha: true, unknownRequired: 0 });
    expect(plan.submit).toBe(false);
    expect(plan.steps).not.toContain("submit");
    expect(preparationDecision(true, false)).toBe("REUSE");
  });
});
