import { describe, expect, it } from "vitest";
import { answerQuestion } from "@/lib/applications/questions";
import { buildCoverLetter } from "@/lib/applications/cover-letter";
import { buildCvDraft } from "@/lib/applications/cv";
import { selectEvidence } from "@/lib/applications/evidence-selection";
import { scoreJobFit } from "@/lib/applications/fit";
import {
  confirmEvidence,
  durationLabel,
  evidenceForProfile,
  evidenceIdentity,
  explicitProficiency,
  explicitProjectTechnologies,
  explicitYears,
  factIsAutomaticEvidence,
  historyDetail,
  parseEvidenceImport,
  planEvidenceWrite,
  rejectEvidence,
  reviewerMapping,
  testEvidenceFixture,
  toEvidenceRecord,
  verifiedConflicts,
} from "@/lib/applications/evidence-management";
import { extractRequirements } from "@/lib/applications/requirements";
import { seedCandidateRecord } from "@/lib/applications/seed-data";
import type { CandidateRecord, JobInput } from "@/lib/applications/types";

const job: JobInput = {
  title: "Software Engineer",
  companyName: "Northwind",
  description: "Build product features with TypeScript and PostgreSQL.",
  applicationUrl: "https://boards.greenhouse.io/northwind/jobs/1",
};

describe("candidate evidence library", () => {
  it("creates, updates, and replaces evidence without duplicating a technology", () => {
    const created = planEvidenceWrite([], {
      claim: "TypeScript",
      type: "LANGUAGE",
      source: "ProspectPilot project",
      origin: "CANDIDATE_ENTERED",
      verification: "VERIFIED",
      profiles: ["SOFTWARE"],
      duration: null,
    });
    expect(created.action).toBe("create");
    const existing = testEvidenceFixture().filter((item) => item.id === "ts");
    const updated = planEvidenceWrite(existing, {
      claim: "typescript",
      type: "TECHNOLOGY",
      source: "ProspectPilot project",
      origin: "CANDIDATE_ENTERED",
      verification: "VERIFIED",
      profiles: ["SOFTWARE", "WEB", "SAAS"],
      duration: null,
    });
    expect(updated.action).toBe("update");
    if (updated.action === "update") {
      expect(updated.existingId).toBe("ts");
      expect(updated.profilesChanged).toBe(true);
    }
    expect(evidenceIdentity("LANGUAGE", "TypeScript")).toBe(evidenceIdentity("TECHNOLOGY", "TypeScript"));
    expect(evidenceIdentity("DATABASE", "PostgreSQL")).not.toBe(evidenceIdentity("TECHNOLOGY", "TypeScript"));
  });

  it("keeps a verified fact when a later import is only pending review", () => {
    const existing = testEvidenceFixture().filter((item) => item.id === "ts");
    const plan = planEvidenceWrite(existing, {
      claim: "TypeScript",
      type: "LANGUAGE",
      source: "import",
      origin: "CANDIDATE_ENTERED",
      verification: "PENDING_REVIEW",
      profiles: ["SOFTWARE"],
      duration: null,
    });
    expect(plan.action).toBe("conflict");
  });

  it("imports unconfirmed technology as pending review and confirms or rejects it", () => {
    const parsed = parseEvidenceImport('[{"claim":"GraphQL","type":"TECHNOLOGY","source":"notes","profiles":["SOFTWARE"]}]');
    expect(parsed.items[0]?.verification).toBe("PENDING_REVIEW");
    expect(parsed.items[0]?.origin).toBe("CANDIDATE_ENTERED");
    const pending = toEvidenceRecord({ id: "g", category: "TECHNOLOGY", fact: "GraphQL", source: "notes", sourceType: "CANDIDATE_ENTERED", verified: false, verification: "PENDING_REVIEW" });
    expect(confirmEvidence(pending)).toBe("VERIFIED");
    expect(rejectEvidence(pending)).toBe("REJECTED");
    expect(factIsAutomaticEvidence({ verified: false, verification: "PENDING_REVIEW", sourceType: "CANDIDATE_ENTERED", fact: "GraphQL" })).toBe(false);
    expect(factIsAutomaticEvidence({ verified: false, verification: "REJECTED", sourceType: "CANDIDATE_ENTERED", fact: "GraphQL" })).toBe(false);
  });

  it("excludes system-generated and generated documents from automatic evidence", () => {
    const fixture = testEvidenceFixture();
    const generated = fixture.find((item) => item.id === "generated");
    expect(generated?.origin).toBe("SYSTEM_GENERATED");
    expect(factIsAutomaticEvidence({ verified: true, verification: "VERIFIED", sourceType: "SYSTEM_GENERATED", source: "generated-cv", fact: "Rust" })).toBe(false);
    expect(factIsAutomaticEvidence({ verified: true, sourceType: "CANDIDATE_ENTERED", source: "generated cover letter", fact: "Rust" })).toBe(false);
    expect(factIsAutomaticEvidence({ verified: true, sourceType: "REPOSITORY_VERIFIED", fact: "TypeScript", source: "ProspectPilot project" })).toBe(true);
    expect(toEvidenceRecord({ id: "repo", category: "TECHNOLOGY", fact: "TypeScript", source: "repository", sourceType: "REPOSITORY_VERIFIED", verified: true }).origin).toBe("VERIFIED_SOURCE");
  });

  it("does not infer technologies, years, or skill ratings", () => {
    expect(explicitProjectTechnologies({ technologies: [], verified: true, description: "Built a web application." })).toEqual([]);
    expect(explicitProjectTechnologies({ technologies: ["TypeScript", "PostgreSQL"], verified: true, description: "Built a web application." })).toEqual(["TypeScript", "PostgreSQL"]);
    expect(explicitProjectTechnologies({ technologies: ["Node.js"], verified: false })).toEqual([]);
    expect(durationLabel(null)).toBe("UNKNOWN");
    expect(explicitYears(null)).toBeNull();
    expect(explicitYears("3 years")).toBe(3);
    expect(explicitProficiency("TypeScript proficiency")).toBeNull();
    expect(explicitProficiency("TypeScript proficiency: Advanced")).toBe("Advanced");
  });

  it("flags conflicting verified durations and records history without secrets", () => {
    const [first, ...rest] = testEvidenceFixture();
    const conflict = verifiedConflicts([
      first!,
      { ...first!, id: "ts-2", duration: "4 years" },
      ...rest,
    ]);
    expect(conflict[0]).toContain("TypeScript");
    expect(historyDetail("CREATED", "TypeScript")).toBe("Created TypeScript");
    expect(planEvidenceWrite([], {
      claim: "token=abc",
      type: "OTHER",
      source: "notes",
      origin: "CANDIDATE_ENTERED",
      verification: "VERIFIED",
      profiles: [],
      duration: null,
    }).action).toBe("reject");
  });

  it("uses only the fixture evidence that is verified, allowed, and on the right profile", () => {
    const fixture = testEvidenceFixture();
    const allowed = fixture.filter((item) => factIsAutomaticEvidence({
      verified: item.verification === "VERIFIED",
      verification: item.verification,
      sourceType: item.storedOrigin,
      source: item.source,
      fact: item.claim,
    }));
    expect(allowed.map((item) => item.id).sort()).toEqual(["education", "growth", "pg", "saas", "salary", "ts"]);
    expect(evidenceForProfile(fixture, "SOFTWARE").map((item) => item.id).sort()).toEqual(["education", "pg", "saas", "ts"]);
    expect(evidenceForProfile(fixture, "MARKETING").map((item) => item.id)).toEqual(["growth"]);
    const mapping = reviewerMapping("Experience with PostgreSQL", fixture);
    expect(mapping.classification).toBe("DIRECT");
    expect(mapping.evidence).toBe("PostgreSQL");
    expect(mapping.type).toBe("DATABASE");
    expect(mapping.verification).toBe("VERIFIED");
    expect(reviewerMapping("Experience with Node.js", fixture).classification).toBe("MISSING");
  });

  it("keeps unverified, missing, and generated evidence out of matching, CVs, cover letters, and answers", () => {
    const candidate = evidenceCandidate();
    const fit = scoreJobFit(job, candidate, extractRequirements(job.description));
    expect(fit.selectedFacts.some((fact) => /graphql|rust|node\.js/i.test(fact.fact))).toBe(false);
    const usable = candidate.facts.filter((fact) => factIsAutomaticEvidence(fact));
    expect(selectEvidence("Node.js", usable).match).toBe("MISSING");
    expect(selectEvidence("GraphQL", usable).match).toBe("MISSING");
    expect(selectEvidence("TypeScript", usable).match).toBe("DIRECT");
    const cv = buildCvDraft(job, candidate, fit);
    expect(cv.text).not.toMatch(/GraphQL|Node\.js|Rust/i);
    const cover = buildCoverLetter(job, candidate, fit);
    expect(cover).not.toMatch(/GraphQL|Node\.js|Rust/i);
    const years = answerQuestion("How many years of TypeScript experience?", job, candidate, fit);
    expect(years.status).toBe("REVIEW_REQUIRED");
    const rating = answerQuestion("Rate your TypeScript skill level.", job, candidate, fit);
    expect(rating.status).toBe("REVIEW_REQUIRED");
    expect(rating.source).not.toBe("MODEL_GUESS");
    const salary = answerQuestion("What is your salary expectation?", job, candidate, fit);
    expect(salary.answer).toContain("100000");
    expect(salary.source).toBe("CANDIDATE_ENTERED");
    const authorization = answerQuestion("Are you authorized to work?", job, candidate, fit);
    expect(authorization.status).toBe("REVIEW_REQUIRED");
  });
});

function evidenceCandidate(): CandidateRecord {
  const seed = seedCandidateRecord();
  return {
    ...seed,
    salaryExpectation: "100000 USD per year",
    workAuthorization: null,
    facts: [
      ...seed.facts.filter((fact) => !/graphql|node\.js|rust/i.test(fact.fact)),
      { id: "edu", category: "EDUCATION", fact: "Education, Example University, BSc", verified: true, sourceType: "CANDIDATE_ENTERED", profiles: ["SOFTWARE"], verification: "VERIFIED" },
      { id: "salary", category: "IDENTITY", fact: "Salary expectation: 100000 USD per year", verified: true, sourceType: "CANDIDATE_ENTERED", profiles: [], verification: "VERIFIED" },
      { id: "graphql", category: "TECHNOLOGY", fact: "GraphQL", verified: false, sourceType: "CANDIDATE_ENTERED", profiles: ["SOFTWARE"], verification: "REVIEW_REQUIRED", technologies: ["GraphQL"] },
      { id: "rust", category: "TECHNOLOGY", fact: "Rust", verified: true, sourceType: "SYSTEM_GENERATED", profiles: ["SOFTWARE"], verification: "VERIFIED", technologies: ["Rust"] },
      { id: "rating", category: "SKILL", fact: "TypeScript proficiency", verified: false, sourceType: "CANDIDATE_ENTERED", profiles: ["SOFTWARE"], verification: "REVIEW_REQUIRED" },
    ],
  };
}
