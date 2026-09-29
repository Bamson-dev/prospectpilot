import { describe, expect, it } from "vitest";
import { documentAccess } from "@/lib/applications/access";
import { missingCandidateFields, optionalCandidateFacts } from "@/lib/applications/candidate-fields";
import { unsupportedClaims } from "@/lib/applications/claims";
import { chooseProfile, scoreJobFit } from "@/lib/applications/fit";
import { assemblePackage } from "@/lib/applications/package";
import { answerQuestion } from "@/lib/applications/questions";
import { extractRequirements } from "@/lib/applications/requirements";
import { sameVacancy } from "@/lib/applications/dedupe";
import { discoveryBlock } from "@/lib/applications/providers";
import { CAREER_PROFILES, seedCandidateRecord, unknownCandidateFields } from "@/lib/applications/seed-data";
import { canTransition } from "@/lib/applications/state";
import { emptyTimings, packageReadiness, throughputReport } from "@/lib/applications/throughput";
import { authenticationRequired } from "@/lib/applications/auth-detect";
import { normalizeWorkMode } from "@/lib/applications/normalize";
import { validateCandidateProfile } from "@/lib/applications/profile-validation";
import { bannedPhrases } from "@/lib/applications/writing";
import type { JobInput } from "@/lib/applications/types";

const person = { ...seedCandidateRecord(), email: "bamidele@example.com" };

function vacancy(title: string, description: string): JobInput {
  return { title, companyName: "Northwind", description, applicationUrl: "https://jobs.example/1", location: "Remote" };
}

describe("candidate positioning", () => {
  it("keeps seven presentations of one candidate and leaves unknown fields unknown", () => {
    expect(CAREER_PROFILES.map((profile) => profile.kind)).toEqual(["SOFTWARE", "WEB", "SAAS", "MARKETING", "GROWTH", "FOUNDER", "HYBRID"]);
    expect(unknownCandidateFields()).toEqual(expect.arrayContaining(["linkedin", "education", "certifications"]));
    const form = new FormData();
    form.set("salaryExpectation", "not invented");
    const parsed = optionalCandidateFacts(form);
    expect(parsed.error).toBeNull();
    expect(parsed.facts.find((fact) => fact.subcategory === "salary-expectation")?.fact).toBe("Salary expectation: not invented");
    expect(parsed.facts.find((fact) => fact.subcategory === "linkedin")?.fact).toBe("");
    const badLink = new FormData();
    badLink.set("linkedin", "bamidele");
    expect(optionalCandidateFacts(badLink).error).toContain("LinkedIn");
    expect(missingCandidateFields({ phone: null, location: null, facts: person.facts }).length).toBeGreaterThan(3);
    expect(person.projects.find((project) => project.name === "LeadThur")?.technologies).toEqual([]);
    expect(person.projects.find((project) => project.name === "ProspectPilot")?.technologies).toContain("TypeScript");
    expect(person.projects.find((project) => project.name === "ProspectPilot")?.technologies).not.toContain("AWS");
  });

  it("leaves unproven years uncertain and ignores generated credentials", () => {
    const fit = scoreJobFit(vacancy("Software Engineer", "5 years React required."), person, extractRequirements("5 years React required."));
    expect(fit.uncertain.some((item) => /UNKNOWN/i.test(item))).toBe(true);
    expect(fit.requirementMatches.some((item) => /5 years/i.test(item))).toBe(false);
    const generated = {
      ...person,
      facts: [...person.facts, { id: "gen", category: "TECHNOLOGY" as const, fact: "ProspectPilot uses Rust", verified: true, profiles: ["SOFTWARE" as const], technologies: ["Rust"], sourceType: "SYSTEM_GENERATED" as const }],
    };
    expect(unsupportedClaims("Used Rust at Fake Corporation.", generated).unsupported).toEqual(expect.arrayContaining(["rust", "Fake Corporation"]));
  });

  it("does not treat a preferred skill as a required gap", () => {
    const description = "TypeScript required.\nFigma preferred.\n3 years required.\n5 years preferred.";
    const requirements = extractRequirements(description);
    const fit = scoreJobFit(vacancy("Software Engineer", description), person, requirements);
    expect(fit.missingRequirements.some((item) => /figma/i.test(item))).toBe(false);
    expect(fit.preferredGaps.some((item) => /figma/i.test(item)) || fit.preferredMatches.some((item) => /figma/i.test(item))).toBe(true);
    expect(requirements.find((item) => item.text.startsWith("5"))?.required).toBe(false);
    expect(requirements.find((item) => item.text.startsWith("3"))?.required).toBe(true);
  });

  it("selects a different profile and CV emphasis for each role family", () => {
    const cases: Array<[string, string, string]> = [
      ["Software Engineer", "Build APIs and web applications with TypeScript.", "SOFTWARE"],
      ["Frontend Developer", "Build interfaces in React.", "WEB"],
      ["Full-stack Developer", "Build a full-stack product with PostgreSQL.", "SOFTWARE"],
      ["Web Developer", "Build a marketing website.", "WEB"],
      ["Web Designer", "Design landing pages and websites.", "WEB"],
      ["Product Engineer", "Own a SaaS product.", "SAAS"],
      ["Growth Marketing Manager", "Own acquisition and affiliate growth.", "MARKETING"],
      ["Performance Marketing Manager", "Run performance marketing.", "MARKETING"],
      ["Digital Marketing Manager", "Own digital marketing.", "MARKETING"],
      ["Head of Growth", "Lead go-to-market and partnerships.", "GROWTH"],
      ["Founder in Residence", "Build a company.", "FOUNDER"],
    ];
    const seen = new Set<string>();
    for (const [title, description, profile] of cases) {
      const pack = assemblePackage(vacancy(title, description), person);
      expect(chooseProfile(vacancy(title, description))).toBe(profile);
      expect(pack.fit.profile).toBe(profile);
      expect(pack.cv?.text).toContain("Bamidele Matthew");
      expect(pack.cv?.text.toLowerCase()).not.toContain("i am excited");
      expect(pack.coverLetter).toContain(title);
      expect(pack.coverLetter).toContain("Northwind");
      seen.add(pack.cv?.headline ?? "");
    }
    expect(seen.size).toBeGreaterThan(3);
    const software = assemblePackage(vacancy("Software Engineer", "Build APIs with TypeScript and PostgreSQL."), person);
    const marketing = assemblePackage(vacancy("Growth Marketing Manager", "Own affiliate acquisition and go-to-market work."), person);
    expect(software.cv?.text).toContain("ProspectPilot");
    expect(software.cv?.text).not.toContain("$1.5 million");
    expect(marketing.cv?.text).toContain("PromptEarn");
    expect(marketing.cv?.text).not.toContain("Tailwind");
  });

  it("refuses unknown legal and portfolio answers", () => {
    const fit = scoreJobFit(vacancy("Software Engineer", "TypeScript required."), person, []);
    expect(answerQuestion("Are you authorized to work?", vacancy("Software Engineer", "TypeScript."), person, fit).status).toBe("REVIEW_REQUIRED");
    expect(answerQuestion("What is your LinkedIn?", vacancy("Software Engineer", "TypeScript."), person, fit).status).toBe("REVIEW_REQUIRED");
    expect(answerQuestion("Tell me about a time you led a team.", vacancy("Software Engineer", "TypeScript."), person, fit).status).toBe("REVIEW_REQUIRED");
    expect(bannedPhrases("I am excited to apply")).toEqual(["i am excited to apply"]);
  });

  it("keeps documents inside the organization and does not invent a throughput benchmark", () => {
    expect(documentAccess("org-a", "org-b")).toBe("deny");
    expect(documentAccess("org-a", "org-a")).toBe("allow");
    expect(canTransition("READY_FOR_REVIEW", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "SUBMITTED")).toBe(false);
    expect(sameVacancy(
      { companyName: "Northwind", title: "Engineer", applicationUrl: "https://jobs.example/a", location: "Remote" },
      { companyName: "northwind", title: "Engineer", applicationUrl: "https://jobs.example/b", location: "Remote" },
    )).toBe(false);
    expect(discoveryBlock(403, "ok")).toBe("blocked");
    expect(discoveryBlock(200, "Verify you are human")).toBe("blocked");
    expect(throughputReport({ discovered: 0, analyzed: 0, packages: 0, submitted: 0, failed: 0, manual: 0, elapsedMs: 0 }).benchmarked).toBe(false);
    const timings = emptyTimings(12);
    expect(timings.cvMs).toBe(0);
    expect(timings.totalMs).toBe(12);
    expect(packageReadiness({ claimsOk: true, contactReady: false, unresolvedQuestions: false, documentError: false })).toBe("REQUIRES_REVIEW");
    expect(authenticationRequired({ text: "Sign in to apply", fieldTypes: [] })).toBe(true);
    expect(authenticationRequired({ text: "Public application", fieldTypes: ["password"] })).toBe(true);
    expect(normalizeWorkMode("Remote, Canada").geographicRestriction).toBe("Canada");
    expect(normalizeWorkMode("Remote, Canada").remoteType).toBe("remote");
    const form = new FormData();
    form.set("email", "not-an-email");
    expect(validateCandidateProfile(form).error).toContain("email");
  });
});
