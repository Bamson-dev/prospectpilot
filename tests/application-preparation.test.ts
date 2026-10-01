import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adapterFor } from "@/lib/applications/adapters";
import { fillApplicationPage } from "@/lib/applications/browser";
import { validateCoverLetterForVacancy, validateResumePackage } from "@/lib/applications/document-check";
import { classifyField, fieldsFromHtml, inspectFields, mapCandidateToFields } from "@/lib/applications/form-map";
import { detectPlatform } from "@/lib/applications/platforms";
import { answerQuestion } from "@/lib/applications/questions";
import { candidateReadiness } from "@/lib/applications/readiness";
import { detectSecurityBarrier } from "@/lib/applications/security";
import { seedCandidateRecord } from "@/lib/applications/seed-data";
import { canTransition } from "@/lib/applications/state";
import { CONFIRM_PHRASE, evaluateSubmissionGate, submissionAllowed } from "@/lib/applications/submission-gate";
import { packageReadiness } from "@/lib/applications/throughput";
import { scoreJobFit } from "@/lib/applications/fit";

const job = { title: "Software Engineer", companyName: "Northwind", description: "TypeScript.", applicationUrl: "https://boards.greenhouse.io/northwind/jobs/1" };

const greenhouseForm = `<form>
  <label for="first_name">First name</label><input id="first_name" name="first_name" required />
  <label for="last_name">Last name</label><input id="last_name" name="last_name" required />
  <label for="email">Email</label><input id="email" name="email" type="email" required />
  <label for="phone">Phone</label><input id="phone" name="phone" />
  <label for="job_application_answers_linkedin">LinkedIn</label><input id="job_application_answers_linkedin" name="job_application_answers_linkedin" />
  <label for="resume">Resume</label><input id="resume" name="resume" type="file" required />
  <label for="cover_letter">Cover letter</label><textarea id="cover_letter" name="cover_letter"></textarea>
  <label>How many years of TypeScript?</label><input name="years_typescript" />
</form>`;

describe("controlled application preparation", () => {
  it("reports missing candidate fields without inventing them", () => {
    const readiness = candidateReadiness({ email: "person@example.com", phone: "" });
    expect(readiness.status).toBe("INCOMPLETE");
    expect(readiness.missing).toContain("phone");
    expect(readiness.missing).toContain("salary expectation");
    expect(readiness.fields.find((field) => field.field === "email")?.state).toBe("KNOWN");
    expect(candidateReadiness({ email: "needs-email@invalid.test" }).fields.find((field) => field.field === "email")?.state).toBe("REVIEW_REQUIRED");
    const complete = candidateReadiness({
      email: "person@example.com", phone: "+44 7700 900000", location: "London",
      linkedinUrl: "https://www.linkedin.com/in/example", portfolioUrl: "https://example.com", githubUrl: "https://github.com/example",
      workAuthorization: "On file", sponsorship: "No", availability: "Immediate", noticePeriod: "2 weeks",
      degree: "Not stored as a credential", institution: "Named by the candidate", certification: "None on file",
      salaryExpectation: "100000 USD per year",
    });
    expect(complete.status).toBe("READY");
  });

  it("keeps a valid package reviewable and an unknown salary in review", () => {
    expect(packageReadiness({ claimsOk: true, contactReady: true, unresolvedQuestions: false, documentError: false, workAuthorizationKnown: true, sponsorshipKnown: true, salaryKnown: true, noticeKnown: true, uncertainRequirement: false })).toBe("READY_FOR_REVIEW");
    expect(packageReadiness({ claimsOk: true, contactReady: true, unresolvedQuestions: false, documentError: false, workAuthorizationKnown: false, sponsorshipKnown: true, salaryKnown: true, noticeKnown: true })).toBe("REQUIRES_REVIEW");
    expect(packageReadiness({ claimsOk: true, contactReady: true, unresolvedQuestions: false, documentError: false, salaryKnown: false })).toBe("REQUIRES_REVIEW");
  });

  it("detects platforms from the URL and not from a company name", () => {
    expect(detectPlatform({ url: "https://job-boards.greenhouse.io/acme/jobs/1" })).toBe("GREENHOUSE");
    expect(detectPlatform({ url: "https://jobs.lever.co/acme/1" })).toBe("LEVER");
    expect(detectPlatform({ url: "https://jobs.ashbyhq.com/acme/1" })).toBe("ASHBY");
    expect(detectPlatform({ url: "https://apply.workable.com/acme/j/1" })).toBe("WORKABLE");
    expect(detectPlatform({ url: "https://jobs.smartrecruiters.com/acme/1" })).toBe("SMARTRECRUITERS");
    expect(detectPlatform({ url: "https://greenhouse.example.com/jobs/1" })).toBe("GENERIC");
    expect(detectPlatform({ url: "not a url" })).toBe("UNKNOWN");
    expect(adapterFor("https://boards.greenhouse.io/acme/jobs/1").detect("https://boards.greenhouse.io/acme/jobs/1")).toBe(true);
    expect(adapterFor("https://boards.greenhouse.io/acme/jobs/1").prepare().submit).toBe(false);
  });

  it("classifies and maps only fields that exist", () => {
    const fields = inspectFields(fieldsFromHtml(greenhouseForm));
    expect(fields.find((field) => field.name === "email")?.classification).toBe("CONTACT");
    expect(fields.find((field) => field.name === "resume")?.classification).toBe("RESUME");
    expect(fields.find((field) => field.name === "cover_letter")?.classification).toBe("COVER_LETTER");
    expect(classifyField({ label: "Favorite snack", required: true })).toBe("UNKNOWN");
    const mapped = mapCandidateToFields(fields, { firstName: "Bamidele", lastName: "Matthew", email: "person@example.com", phone: "", yearsExperience: "" });
    expect(mapped.find((item) => item.name === "email")?.status).toBe("ANSWERED");
    expect(mapped.find((item) => item.name === "phone")?.status).toBe("REVIEW_REQUIRED");
    expect(mapped.find((item) => item.name === "years_typescript")?.status).toBe("REVIEW_REQUIRED");
    const byId = mapCandidateToFields(inspectFields(fieldsFromHtml(`<label for="first_name">First name</label><input id="first_name" aria-required="true" />`)), { firstName: "Bamidele" });
    expect(byId[0]?.status).toBe("ANSWERED");
    const ambiguous = mapCandidateToFields(inspectFields([{ label: "Website or LinkedIn", name: "links", type: "text", required: false }]), { linkedin: "https://www.linkedin.com/in/example", portfolio: "https://example.com" });
    expect(ambiguous[0]?.status).toBe("REVIEW_REQUIRED");
    expect(ambiguous[0]?.reason).toBe("ambiguous field");
  });

  it("does not infer years or legal answers", () => {
    const person = seedCandidateRecord();
    person.projects[0].description = "Started in 2019";
    const fit = scoreJobFit(job, person, []);
    expect(answerQuestion("Years of experience with TypeScript?", job, person, fit).status).toBe("REVIEW_REQUIRED");
    expect(answerQuestion("Are you authorized to work in the United States?", job, person, fit).status).toBe("REVIEW_REQUIRED");
    expect(answerQuestion("What is your salary expectation?", job, person, fit).status).toBe("REVIEW_REQUIRED");
    expect(answerQuestion("Will you require sponsorship?", job, { ...person, sponsorship: "No sponsorship is required." }, fit).status).toBe("ANSWERED");
  });

  it("validates resume files and the vacancy on the cover letter", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
    expect(validateResumePackage({ pdf, docx, fileName: "Bamidele-Matthew-Software-Engineer-Northwind.pdf", text: "Bamidele Matthew person@example.com", candidateName: "Bamidele Matthew", email: "person@example.com" }).ok).toBe(true);
    expect(validateResumePackage({ pdf: new Uint8Array(), docx, fileName: "resume.pdf", text: "needs-email@invalid.test", candidateName: "Bamidele Matthew", email: "needs-email@invalid.test" }).ok).toBe(false);
    expect(validateCoverLetterForVacancy({ text: "I am applying for the Software Engineer role at Northwind.", companyName: "Northwind", title: "Software Engineer" }).ok).toBe(true);
    expect(validateCoverLetterForVacancy({ text: "I am applying for the Software Engineer role at Other Co.", companyName: "Northwind", title: "Software Engineer", otherCompany: "Other Co" }).ok).toBe(false);
  });

  it("stops on security barriers and unknown required fields", () => {
    expect(detectSecurityBarrier({ text: "Please solve the captcha" })).toBe("captcha");
    expect(detectSecurityBarrier({ text: "Checking your browser before accessing Cloudflare" })).toBe("cloudflare");
    expect(detectSecurityBarrier({ text: "Sign in to apply", fieldTypes: [] })).toBe("authentication");
    expect(detectSecurityBarrier({ text: "Create an account to continue" })).toBe("account-creation");
    expect(detectSecurityBarrier({ text: "Too many requests", statusCode: 429 })).toBe("rate-limit");
    const unknown = mapCandidateToFields(inspectFields(fieldsFromHtml(`<label>Favorite color required</label><input name="favorite_color" required />`)), {});
    expect(unknown[0]?.status).toBe("UNSUPPORTED");
    expect(adapterFor("https://example.com/jobs").requiresManualAction({ text: "Apply", mapped: unknown })).toBe("unknown-required-field");
  });

  it("keeps approval separate from submission", () => {
    expect(canTransition("APPROVED", "READY_FOR_SUBMISSION")).toBe(true);
    expect(canTransition("APPROVED", "SUBMITTED")).toBe(false);
    expect(canTransition("APPROVED", "SUBMITTING")).toBe(false);
    expect(canTransition("READY_FOR_SUBMISSION", "SUBMITTING")).toBe(true);
    expect(canTransition("READY_TO_SUBMIT", "SUBMITTING")).toBe(false);
    const preview = {
      phrase: CONFIRM_PHRASE,
      company: "Northwind",
      role: "Software Engineer",
      applicationUrl: "https://boards.greenhouse.io/northwind/jobs/1",
      cvFileName: "Bamidele-Matthew-Software-Engineer-Northwind.pdf",
      coverLetterFileName: "letter.pdf",
      answers: [],
      workAuthorization: "On file",
      sponsorship: "No",
      salary: "100000 USD per year",
      reviewRequired: [],
      security: null,
    };
    const expected = { company: preview.company, role: preview.role, applicationUrl: preview.applicationUrl, cvFileName: preview.cvFileName };
    expect(evaluateSubmissionGate({ ...preview, phrase: "Approve" }, expected).maySubmit).toBe(false);
    expect(evaluateSubmissionGate(preview, expected).maySubmit).toBe(false);
    expect(evaluateSubmissionGate(preview, expected).status).toBe("READY_FOR_HUMAN_SUBMISSION");
    expect(submissionAllowed({ phrase: CONFIRM_PHRASE, pageUrl: "https://boards.greenhouse.io/northwind/jobs/1", liveFlag: true })).toBe(false);
    expect(submissionAllowed({ phrase: CONFIRM_PHRASE, pageUrl: "http://127.0.0.1/form", liveFlag: true })).toBe(true);
    expect(submissionAllowed({ phrase: CONFIRM_PHRASE, pageUrl: "http://127.0.0.1/form", liveFlag: false })).toBe(false);
  });

  it("does not submit local fixtures in prepare-only mode", async () => {
    const pages: Record<string, string> = {
      "/normal": greenhouseForm,
      "/captcha": "<html><body>Verify you are human</body></html>",
      "/login": "<html><body><form>Sign in to apply <input type='password' name='password' /></form></body></html>",
      "/cloudflare": "<html><body>Just a moment... Checking your browser Cloudflare</body></html>",
      "/unknown": "<form><label>Favorite color</label><input name='favorite_color' required /><button type='submit'>Submit</button></form>",
      "/optional": "<form><label>Email</label><input name='email' /><textarea name='notes'>Anything else?</textarea><button type='submit'>Submit</button></form>",
      "/resume": "<form><label>Resume</label><input name='resume' type='file' /><button type='submit'>Submit</button></form>",
      "/letter": "<form><label>Cover letter</label><textarea name='cover_letter'></textarea><button type='submit'>Submit</button></form>",
    };
    const server = createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<html><body>${pages[request.url ?? ""] ?? ""}<script>document.addEventListener("submit", () => { window.__submitted = true; }, true);</script></body></html>`);
    });
    await listen(server);
    const port = (server.address() as { port: number }).port;
    const browser = await launchChromium();
    try {
      const page = await browser.newPage();
      for (const path of Object.keys(pages)) {
        await page.goto(`http://127.0.0.1:${port}${path}`);
        await page.evaluate(() => { (window as unknown as { __submitted?: boolean }).__submitted = false; });
        const result = await fillApplicationPage(page, { email: "person@example.com", firstName: "Bamidele", lastName: "Matthew" }, { mode: "PREPARE_ONLY", submit: true, confirmationPhrase: CONFIRM_PHRASE });
        const clicked = await page.evaluate(() => Boolean((window as unknown as { __submitted?: boolean }).__submitted));
        expect(clicked).toBe(false);
        expect(result.submitted).toBe(false);
        if (path === "/captcha") expect(result.reason).toBe("CAPTCHA_REQUIRED");
        if (path === "/login") expect(result.reason).toBe("LOGIN_REQUIRED");
        if (path === "/cloudflare") expect(result.reason).toBe("CLOUDFLARE_CHALLENGE");
        if (path === "/unknown") expect(result.reason).toBe("unknown-required-field");
      }
    } finally {
      await browser.close();
      await close(server);
    }
  }, 40000);
});

async function launchChromium() {
  const { chromium } = await import("playwright");
  const arm = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
  if (existsSync(arm)) return chromium.launch({ executablePath: arm, headless: true });
  return chromium.launch({ headless: true });
}

function listen(server: Server) {
  return new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}
