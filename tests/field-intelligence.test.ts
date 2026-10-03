import { describe, expect, it } from "vitest";
import { classificationReport, classifyField, fieldsFromHtml, inspectFields, mapCandidateToFields } from "@/lib/applications/form-map";
import { judgeField } from "@/lib/applications/field-taxonomy";
import { interpretLocation, locationSatisfied, normalizeWorkMode } from "@/lib/applications/normalize";
import { auditPackage } from "@/lib/applications/package-audit";
import { applicationPreview } from "@/lib/applications/preview";
import { answerQuestion } from "@/lib/applications/questions";
import { seedCandidateRecord } from "@/lib/applications/seed-data";
import { scoreJobFit } from "@/lib/applications/fit";
import { detectSecurityBarrier } from "@/lib/applications/security";
import { submissionAllowed } from "@/lib/applications/submission-gate";

const airbnbLike = `
<h2>Personal Information</h2>
<label for="first_name">First Name</label><input id="first_name" autocomplete="given-name" aria-required="true" />
<label for="last_name">Family Name</label><input id="last_name" aria-required="true" />
<label for="email">Email Address</label><input id="email" type="email" aria-required="true" />
<label for="phone">Mobile Phone</label><input id="phone" type="tel" autocomplete="tel" />
<label for="candidate-location">Where are you currently based?</label><input id="candidate-location" />
<h2>Professional</h2>
<label for="linkedin">LinkedIn Profile</label><input id="linkedin" />
<label for="github">GitHub URL</label><input id="github" />
<label for="portfolio">Portfolio URL</label><input id="portfolio" />
<label for="resume">Resume</label><input id="resume" type="file" aria-required="true" />
<label for="cover_letter">Cover Letter</label><textarea id="cover_letter"></textarea>
<h2>Employment</h2>
<label for="auth">Are you authorized to work in the United States?</label><input id="auth" aria-required="true" />
<label for="sponsor">Will you now or in the future require sponsorship?</label><input id="sponsor" aria-required="true" />
<label for="salary">Salary expectation</label><input id="salary" />
<label for="years">How many years of Node.js experience do you have?</label><input id="years" aria-required="true" />
<label for="used">Have you used TypeScript?</label>
<select id="used"><option>Yes</option><option>No</option></select>
<label for="rating">Rate your TypeScript skills from 1-10</label><input id="rating" />
<h2>Education</h2>
<label for="school">School</label><input id="school" />
<h2>Voluntary Self Identification</h2>
<label for="gender">Gender</label><select id="gender" aria-required="true"><option>Decline</option></select>
<label for="veteran">Veteran status</label><input id="veteran" />
<label for="mystery">What is your favorite editor theme?</label><input id="mystery" aria-required="true" />
<fieldset><legend>Sponsorship</legend>
<label>Yes<input type="radio" name="need_sponsor" value="yes" /></label>
<label>No<input type="radio" name="need_sponsor" value="no" /></label>
</fieldset>
`;

describe("field intelligence", () => {
  it("recognizes synonyms and records confidence", () => {
    expect(classifyField({ label: "Given Name" })).toBe("CONTACT");
    expect(judgeField({ label: "Given Name" }).taxonomy).toBe("FIRST_NAME");
    const phone = judgeField({ label: "Mobile Phone", autocomplete: "tel" });
    expect(phone.taxonomy).toBe("PHONE");
    expect(phone.confidence).toBeGreaterThanOrEqual(0.85);
    expect(phone.evidence).toEqual(expect.arrayContaining(["autocomplete"]));
    const based = judgeField({ label: "Where are you currently based?" });
    expect(based.taxonomy).toBe("LOCATION");
    expect(based.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("uses section context and leaves sensitive answers blank", () => {
    const education = judgeField({ label: "School", section: "Education" });
    const employment = judgeField({ label: "School", section: "Employment history" });
    expect(education.taxonomy).toBe("INSTITUTION");
    expect(employment.taxonomy).toBe("CURRENT_COMPANY");
    const fields = inspectFields(fieldsFromHtml(airbnbLike));
    expect(fields.length).toBeGreaterThanOrEqual(20);
    const mapped = mapCandidateToFields(fields, {
      firstName: "Bamidele",
      lastName: "Matthew",
      email: "person@example.com",
    }, ["TypeScript"]);
    expect(mapped.find((item) => item.name === "first_name")?.status).toBe("ANSWERED");
    expect(mapped.find((item) => item.name === "gender")?.status).toBe("REVIEW_REQUIRED");
    expect(mapped.find((item) => item.name === "gender")?.reason).toBe("sensitive question");
    expect(mapped.find((item) => item.name === "years")?.reason).toBe("technology duration is not verified");
    expect(mapped.find((item) => item.name === "used")?.status).toBe("ANSWERED");
    expect(mapped.find((item) => item.name === "rating")?.status).toBe("REVIEW_REQUIRED");
    expect(mapped.find((item) => item.name === "mystery")?.status).toBe("REVIEW_REQUIRED");
    expect(mapped.find((item) => item.name === "mystery")?.reason).toBe("custom question");
    expect(mapped.find((item) => item.required && item.status !== "ANSWERED")?.required).toBe(true);
    expect(mapped.find((item) => item.name === "need_sponsor")?.status).toBe("REVIEW_REQUIRED");
    const report = classificationReport(fields, mapped);
    expect(report.fieldsDetected).toBe(fields.length);
    expect(report.classificationRate).toBeGreaterThan(0.5);
    expect(report.requiredFieldsUnresolved).toBeGreaterThan(0);
  });

  it("does not pick an arbitrary select option or infer location eligibility", () => {
    const country = mapCandidateToFields(inspectFields([{ label: "Country", name: "country", type: "select", options: ["United States", "Canada"], required: true }]), { country: "London" });
    expect(country[0]?.status).toBe("REVIEW_REQUIRED");
    expect(normalizeWorkMode("Remote, Canada").geographicRestriction).toBe("Canada");
    expect(interpretLocation("Remote - United States only")).toMatchObject({ remote: true, eligibleRegion: "US" });
    expect(interpretLocation("Remote anywhere")).toMatchObject({ remote: true, eligibleRegion: "worldwide" });
    expect(locationSatisfied("London", "Remote - United States only")).toBe("FLAG");
    expect(locationSatisfied("United States", "Remote - United States only")).toBe("SATISFIED");
  });

  it("keeps technology, salary, and security questions strict", () => {
    const person = seedCandidateRecord();
    const job = { title: "Engineer", companyName: "Northwind", description: "TypeScript", applicationUrl: "https://example.com" };
    const fit = scoreJobFit(job, person, []);
    expect(answerQuestion("How many years of Node.js experience do you have?", job, person, fit).status).toBe("REVIEW_REQUIRED");
    expect(answerQuestion("Have you used TypeScript?", job, person, fit).answer).toBe("Yes");
    expect(answerQuestion("Rate your TypeScript skills from 1-10", job, person, fit).status).toBe("REVIEW_REQUIRED");
    expect(answerQuestion("What is your salary expectation?", job, person, fit).status).toBe("REVIEW_REQUIRED");
    expect(detectSecurityBarrier({ text: "recaptcha" })).toBe("captcha");
    expect(detectSecurityBarrier({ text: "Checking your browser Cloudflare" })).toBe("cloudflare");
    expect(detectSecurityBarrier({ text: "Sign in to apply" })).toBe("authentication");
    expect(auditPackage({ claimsOk: true, documentsOk: true, captcha: true, authentication: false, unresolvedRequired: 0 }).fill).toBe(false);
    expect(auditPackage({ claimsOk: true, documentsOk: true, captcha: false, authentication: false, unresolvedRequired: 2 }).status).toBe("PACKAGE_REQUIRES_REVIEW");
    expect(submissionAllowed({ phrase: "CONFIRM SUBMISSION", pageUrl: "https://job-boards.greenhouse.io/airbnb/jobs/1", liveFlag: true })).toBe(true);
    const preview = applicationPreview({
      company: "Airbnb",
      role: "Business Systems Engineer",
      resumeFileName: "Bamidele-Matthew-Resume.pdf",
      coverLetterFileName: null,
      captcha: true,
      authentication: false,
      fields: [{ name: "Email", classification: "CONTACT", taxonomy: "EMAIL", confidence: 0.99, required: true, status: "REVIEW_REQUIRED", value: null, source: null, reason: "unknown value" }],
    });
    expect(preview.text).toContain("CAPTCHA: DETECTED");
    expect(preview.result).toBe("REQUIRES_MANUAL_ACTION");
  });
});
