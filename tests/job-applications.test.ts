import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sustainableDailyAttempts } from "@/lib/applications/benchmark";
import { planApplication, verificationFromPage } from "@/lib/applications/browser-plan";
import { fillApplicationPage } from "@/lib/applications/browser";
import { unsupportedClaims } from "@/lib/applications/claims";
import { buildCoverLetter } from "@/lib/applications/cover-letter";
import { buildCvDraft, rewritePreservesVacancy, validateCvText } from "@/lib/applications/cv";
import { applicationIdentity, isDuplicateIdentity } from "@/lib/applications/dedupe";
import { docxContains, pdfLooksReadable, renderDocx, renderPdf } from "@/lib/applications/documents";
import { mapField } from "@/lib/applications/fields";
import { documentFileName } from "@/lib/applications/filenames";
import { scoreJobFit } from "@/lib/applications/fit";
import { dedupeDiscovered, detectProvider, parseJobPage } from "@/lib/applications/providers";
import { answerQuestion, classifyQuestion } from "@/lib/applications/questions";
import { extractRequirements } from "@/lib/applications/requirements";
import { recruiterBrief } from "@/lib/applications/recruiter";
import { seedCandidateRecord } from "@/lib/applications/seed-data";
import { canTransition, retryDecision, statusAfterBlock } from "@/lib/applications/state";
import { DateValidator, FormattingValidator } from "@/lib/applications/validators";
import type { CandidateRecord } from "@/lib/applications/types";

const job = {
  title: "Growth Marketing Manager",
  companyName: "Northwind",
  description: "Own acquisition, affiliate growth, and go-to-market.\n3 years required in growth.\nBachelor degree required.\nRemote.",
  applicationUrl: "https://jobs.example/growth",
};

function candidate(): CandidateRecord {
  const seeded = seedCandidateRecord();
  return { ...seeded, email: "bamidele@example.com" };
}

describe("job application evidence", () => {
  it("keeps required years separate from preferred years", () => {
    const items = extractRequirements("3 years required.\n5 years preferred.");
    expect(items.find((item) => item.text.startsWith("3"))?.required).toBe(true);
    expect(items.find((item) => item.text.startsWith("5"))?.required).toBe(false);
  });

  it("shows a missing degree instead of inventing one", () => {
    const fit = scoreJobFit(job, candidate(), extractRequirements(job.description));
    expect(fit.profile).toBe("MARKETING");
    expect(fit.missingRequirements.some((item) => /bachelor/i.test(item))).toBe(true);
    expect(fit.strongEvidence.some((item) => /PromptEarn/i.test(item))).toBe(true);
  });

  it("selects ProspectPilot technologies for a software vacancy and leaves unverified stacks empty", () => {
    const software = {
      ...job,
      title: "Full-stack engineer",
      description: "Build SaaS products with TypeScript, React, and PostgreSQL.",
    };
    const fit = scoreJobFit(software, candidate(), extractRequirements(software.description));
    expect(fit.profile).toBe("SOFTWARE");
    expect(fit.selectedProjects[0]?.name).toBe("ProspectPilot");
    expect(candidate().projects.find((project) => project.name === "LeadThur")?.technologies).toEqual([]);
  });

  it("rejects an unsupported technology and an invented employer", () => {
    const check = unsupportedClaims("Built Kubernetes at Acme while earning a bachelor degree.", candidate());
    expect(check.ok).toBe(false);
    expect(check.unsupported).toEqual(expect.arrayContaining(["kubernetes", "Acme", "education credential"]));
    const invented = unsupportedClaims("Used Rust at Fake Corporation.", candidate());
    expect(invented.ok).toBe(false);
    expect(invented.unsupported).toEqual(expect.arrayContaining(["rust", "Fake Corporation"]));
  });

  it("builds a CV and cover letter from verified evidence", () => {
    const person = candidate();
    const fit = scoreJobFit(job, person, extractRequirements(job.description));
    const cv = buildCvDraft(job, person, fit);
    expect(cv.text).toContain("Bamidele Matthew");
    expect(rewritePreservesVacancy(cv.text, job.companyName, job.title)).toBe(true);
    expect(rewritePreservesVacancy(cv.text.replaceAll(job.companyName, "a company"), job.companyName, job.title)).toBe(false);
    expect(cv.text).toContain("bamidele@example.com");
    expect(cv.text).not.toMatch(/kubernetes|bachelor|Acme/i);
    const validation = validateCvText(cv.text, person, ["PromptEarn"], [job.companyName]);
    expect(validation.ok).toBe(true);
    expect(DateValidator(cv.text, person).ok).toBe(true);
    expect(FormattingValidator(cv.text).ok).toBe(true);
    expect(buildCoverLetter(job, person, fit)).toContain("Northwind");
    expect(recruiterBrief(job, fit).evidence.length).toBeGreaterThan(0);
  });

  it("asks for input instead of guessing salary or work authorization", () => {
    expect(classifyQuestion("What is your salary expectation?")).toBe("SALARY");
    const fit = scoreJobFit(job, candidate(), []);
    expect(answerQuestion("Are you authorized to work?", job, candidate(), fit).status).toBe("REVIEW_REQUIRED");
    const withAuthorization = {
      ...candidate(),
      facts: [...candidate().facts, { id: "auth", category: "IDENTITY" as const, fact: "Work authorization: stored by the candidate", verified: true, profiles: [] }],
    };
    expect(answerQuestion("Are you authorized to work?", job, withAuthorization, fit).answer).toBe("Work authorization: stored by the candidate");
  });

  it("deduplicates an application url and detects the ATS", () => {
    const left = applicationIdentity({ companyName: "Northwind", title: "Engineer", applicationUrl: "https://boards.greenhouse.io/north/jobs/1/" });
    const right = applicationIdentity({ companyName: "Northwind", title: "Engineer", applicationUrl: "https://boards.greenhouse.io/north/jobs/1" });
    expect(isDuplicateIdentity([left], right)).toBe(true);
    expect(detectProvider("https://jobs.lever.co/acme/1")).toBe("lever");
    const parsed = parseJobPage({ url: "https://example.com/jobs/1", title: "Engineer", text: "We are hiring an engineer for a public product role with a long enough description.", companyName: "Example" });
    expect(dedupeDiscovered([parsed!, parsed!])).toHaveLength(1);
  });

  it("stops submission on captcha and limits retries", () => {
    expect(canTransition("READY_TO_SUBMIT", "SUBMITTING")).toBe(false);
    expect(canTransition("READY_FOR_SUBMISSION", "SUBMITTING")).toBe(true);
    expect(canTransition("APPROVED", "SUBMITTING")).toBe(false);
    expect(canTransition("SUBMITTING", "SUBMITTED")).toBe(true);
    expect(canTransition("PREPARED", "SUBMITTED")).toBe(false);
    expect(statusAfterBlock("captcha")).toBe("CAPTCHA_REQUIRED");
    expect(statusAfterBlock("verification")).toBe("SUBMISSION_UNVERIFIED");
    expect(retryDecision({ statusCode: 429, attempt: 1, maxAttempts: 3 })).toBe("retry");
    expect(retryDecision({ statusCode: 429, attempt: 3, maxAttempts: 3 })).toBe("fail");
    expect(planApplication({ provider: "greenhouse", mode: "AUTO_PREPARE", automationEnabled: true, captcha: false, unknownRequired: 0 }).submit).toBe(false);
    expect(planApplication({ provider: "greenhouse", mode: "AUTO_SUBMIT", automationEnabled: true, captcha: true, unknownRequired: 0 }).reason).toBe("captcha");
    expect(verificationFromPage("Thank you for applying").verified).toBe(true);
    expect(verificationFromPage("Please solve the captcha").status).toBe("REQUIRES_MANUAL_ACTION");
  });

  it("names documents without internal ids", () => {
    expect(documentFileName({ fullName: "Bamidele Matthew", headline: "Growth Marketer", companyName: "Northwind", extension: "pdf" })).toBe("Bamidele-Matthew-Growth-Marketer-Northwind.pdf");
  });

  it("renders a readable PDF and DOCX", async () => {
    const text = buildCvDraft(job, candidate(), scoreJobFit(job, candidate(), extractRequirements(job.description))).text;
    const pdf = await renderPdf(text);
    const docx = await renderDocx(text);
    expect(pdfLooksReadable(pdf, "Bamidele")).toBe(true);
    expect(await docxContains(docx, "Bamidele")).toBe(true);
  });

  it("maps form fields by label and name", () => {
    expect(mapField({ name: "first_name" })).toBe("firstName");
    expect(mapField({ label: "Email address" })).toBe("email");
    expect(mapField({ placeholder: "something else" })).toBeNull();
  });

  it("does not turn a short sample into a 500-application guarantee", () => {
    const result = sustainableDailyAttempts({ attempts: 2, browserMs: 20_000, cvMs: 2_000, submissionMs: 8_000 });
    expect(result.note).toMatch(/not a guarantee/i);
    expect(result.perDay).toBeGreaterThan(0);
  });
});

describe("local application form", () => {
  it("fills a local form and pauses before submit", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<html><body><form>
        <label>First name <input name="first_name" /></label>
        <label>Email <input name="email_address" /></label>
        <button type="submit">Send</button>
      </form></body></html>`);
    });
    await listen(server);
    const port = (server.address() as { port: number }).port;
    const browser = await launchChromium();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);
      const result = await fillApplicationPage(page, { firstName: "Bamidele", email: "bamidele@example.com" }, { mode: "PREPARE_ONLY", submit: false });
      expect(result.status).toBe("READY_FOR_HUMAN_SUBMISSION");
      expect(result.submitted).toBe(false);
      expect(await page.locator("[name=first_name]").inputValue()).toBe("Bamidele");
    } finally {
      await browser.close();
      await close(server);
    }
  }, 30000);

  it("fills select, radio, consent, and the current CV without submitting", async () => {
    const directory = mkdtempSync(join(tmpdir(), "prospectpilot-cv-"));
    const cvPath = join(directory, "cv.pdf");
    writeFileSync(cvPath, "current cv");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<html><body><form>
        <div><label for="first_name">First name</label><input id="first_name" name="first_name" autocomplete="given-name" value="Bamidele" /></div>
        <div><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" /></div>
        <div><label for="city">Current location</label><select id="city" name="city"><option>Choose</option><option>London</option><option>Berlin</option></select></div>
        <fieldset><legend>Where are you currently based</legend><label><input type="radio" name="based" value="London" /> London</label><label><input type="radio" name="based" value="Berlin" /> Berlin</label></fieldset>
        <div><label for="terms">I agree to the terms</label><input id="terms" type="checkbox" name="terms" required /></div>
        <div><label for="marketing">Email me product updates</label><input id="marketing" type="checkbox" name="marketing" /></div>
        <div><label for="resume">Resume</label><input id="resume" type="file" name="resume" /></div>
        <button type="submit">Send</button>
      </form></body></html>`);
    });
    await listen(server);
    const port = (server.address() as { port: number }).port;
    const browser = await launchChromium();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);
      const result = await fillApplicationPage(page, { firstName: "Bamidele", email: "bamidele@example.com", location: "London" }, { mode: "PREPARE_ONLY", submit: true, cvPath });
      expect(result.submitted).toBe(false);
      expect(result.status).not.toBe("SUBMITTED");
      expect(await page.locator("[name=first_name]").inputValue()).toBe("Bamidele");
      expect(await page.locator("[name=email]").inputValue()).toBe("bamidele@example.com");
      expect(await page.locator("[name=city]").inputValue()).toBe("London");
      expect(await page.locator("[name=based][value=London]").isChecked()).toBe(true);
      expect(await page.locator("[name=based][value=Berlin]").isChecked()).toBe(false);
      expect(await page.locator("[name=terms]").isChecked()).toBe(true);
      expect(await page.locator("[name=marketing]").isChecked()).toBe(false);
      expect(await page.locator("[name=resume]").inputValue()).toContain("cv.pdf");
    } finally {
      await browser.close();
      await close(server);
    }
  }, 30000);

  it("verifies a local confirmation and stops on a captcha page", async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      if (request.url === "/captcha") {
        response.end("<html><body>Verify you are human</body></html>");
        return;
      }
      response.end(`<html><body><form><label>Email <input name="email" /></label><button type="submit">Send</button></form>
        <script>document.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); document.body.insertAdjacentHTML("beforeend", "<p>Thank you for applying</p>"); });</script>
        </body></html>`);
    });
    await listen(server);
    const port = (server.address() as { port: number }).port;
    const browser = await launchChromium();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);
      const submitted = await fillApplicationPage(page, { email: "bamidele@example.com" }, { submit: true, mode: "PREPARE_ONLY" });
      expect(submitted.submitted).toBe(false);
      expect(submitted.status).toBe("READY_FOR_HUMAN_SUBMISSION");
      const previous = process.env.APPLICATION_LIVE_SUBMIT;
      process.env.APPLICATION_LIVE_SUBMIT = "true";
      try {
        await page.goto(`http://127.0.0.1:${port}/`);
        const confirmed = await fillApplicationPage(page, { email: "bamidele@example.com" }, { mode: "CONFIRMED_SUBMIT", confirmationPhrase: "CONFIRM SUBMISSION" });
        expect(confirmed.submitted).toBe(true);
        expect(confirmed.status).toBe("SUBMITTED");
      } finally {
        if (previous === undefined) delete process.env.APPLICATION_LIVE_SUBMIT;
        else process.env.APPLICATION_LIVE_SUBMIT = previous;
      }
      await page.goto(`http://127.0.0.1:${port}/captcha`);
      const blocked = await fillApplicationPage(page, {}, { submit: true });
      expect(blocked.status).toBe("REQUIRES_MANUAL_ACTION");
    } finally {
      await browser.close();
      await close(server);
    }
  }, 30000);
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
