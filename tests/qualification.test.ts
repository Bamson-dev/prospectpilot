import { describe, expect, it } from "vitest";
import { selectEvidence } from "@/lib/applications/evidence-selection";
import { assessVacancy, explainQualification } from "@/lib/applications/job-pipeline";
import { extractRequirements } from "@/lib/applications/requirements";
import { seedCandidateRecord } from "@/lib/applications/seed-data";
import { canonicalTechnology, sameTechnology } from "@/lib/applications/technologies";
import type { JobInput } from "@/lib/applications/types";

const person = seedCandidateRecord();

function job(description: string, title = "Software Engineer"): JobInput {
  return { title, companyName: "Example", description, applicationUrl: "https://jobs.example/role" };
}

describe("qualification", () => {
  it("separates responsibilities from hard requirements", () => {
    const items = extractRequirements("You will build APIs.\nWork with cross-functional teams.\nBuild scalable web applications.");
    expect(items.every((item) => item.role === "RESPONSIBILITY")).toBe(true);
    expect(items.some((item) => item.kind === "TECHNOLOGY")).toBe(false);
    const assessed = assessVacancy(job(items.map((item) => item.text).join("\n")), person);
    expect(assessed.explanation.responsibilities.length).toBe(3);
    expect(assessed.fit.selections.some((item) => item.reason === "This is employer context, so it is not matched to candidate evidence.")).toBe(false);
  });

  it("normalizes technology names and refuses related substitutions", () => {
    expect(canonicalTechnology("Postgres")).toBe("postgresql");
    expect(sameTechnology("JS", "JavaScript")).toBe(true);
    expect(sameTechnology("TS", "TypeScript")).toBe(true);
    expect(sameTechnology("Next.js", "Node.js")).toBe(false);
    expect(sameTechnology("React", "Angular")).toBe(false);
    expect(sameTechnology("JavaScript", "Vue.js")).toBe(false);
    expect(selectEvidence("JS", [{ fact: "JavaScript application", technologies: ["JavaScript"], source: "repository" }]).match).toBe("DIRECT");
    expect(selectEvidence("Postgres", [{ fact: "PostgreSQL database", technologies: ["PostgreSQL"], source: "repository" }]).match).toBe("DIRECT");
    const node = selectEvidence("Next.js", [{ fact: "Node.js service", technologies: ["Node.js"], source: "repository" }]);
    expect(node.match).toBe("MISSING");
    expect(node.reason).toMatch(/not treated as the same skill/);
  });

  it("keeps years uncertain unless a verified duration names the technology", () => {
    const unverified = selectEvidence("3+ years of TypeScript", [{ fact: "ProspectPilot uses TypeScript", technologies: ["TypeScript"] }]);
    expect(unverified.match).toBe("UNCERTAIN");
    expect(unverified.reason).toMatch(/no verified duration/i);
    expect(selectEvidence("3 years of TypeScript", [{ fact: "3 years of TypeScript", technologies: ["TypeScript"] }]).match).toBe("DIRECT");
    expect(selectEvidence("5 years of TypeScript", [{ fact: "3 years of AWS", technologies: ["AWS"] }]).match).toBe("UNCERTAIN");
    expect(selectEvidence("5 years of TypeScript", [{ fact: "3 years of TypeScript", technologies: ["TypeScript"] }]).match).toBe("MISSING");
  });

  it("records a transferable match only with the evidence and reason", () => {
    const match = selectEvidence("product work", [{ fact: "This experience is transferable to product work.", source: "candidate" }]);
    expect(match.match).toBe("TRANSFERABLE");
    expect(match.evidence).toMatch(/transferable to product work/i);
    expect(match.reason).toMatch(/transferable to product work/i);
    const saas = assessVacancy(job("Requirements\nExperience building SaaS products.", "Product Engineer"), person);
    const selection = saas.fit.selections.find((item) => /saas/i.test(item.requirement));
    expect(selection?.match).toBe("DIRECT");
    expect(selection?.evidence).toMatch(/SaaS/);
    expect(selection?.reason).toMatch(/SaaS/i);
  });

  it("qualifies direct hard matches while preferred gaps stay visible", () => {
    const assessed = assessVacancy(job("Requirements\nExperience with TypeScript and PostgreSQL.\nGraphQL is preferred.\nYou will build APIs."), person);
    expect(assessed.state).toBe("APPLY");
    expect(assessed.explanation.direct.some((item) => /typescript/i.test(item.requirement) && /typescript/i.test(item.evidence))).toBe(true);
    expect(assessed.explanation.preferred.some((item) => /graphql/i.test(item.requirement) && item.match === "MISSING")).toBe(true);
    expect(assessed.explanation.missingHard).toEqual([]);
    expect(assessed.explanation.responsibilities.some((item) => /build apis/i.test(item))).toBe(true);
  });

  it("treats unresolved years as transferable and missing hard technologies as adjacent", () => {
    const review = assessVacancy(job("Requirements\n5+ years of TypeScript."), person);
    expect(review.state).toBe("APPLY");
    expect(review.opportunity.transferable[0]?.reason).toMatch(/transferable/i);
    const fit = assessVacancy(job("Requirements\nExperience with TypeScript.\nAWS is required."), person);
    expect(fit.state).toBe("APPLY");
    expect(fit.explanation.direct.some((item) => /typescript/i.test(item.evidence))).toBe(true);
  });

  it("reports missing domain evidence for mandatory domains", () => {
    const fintech = assessVacancy(job("Experience with fintech."), person);
    expect(fintech.state).toBe("NOT_A_FIT");
    const communication = extractRequirements("Strong communication skills.");
    expect(communication[0]?.role).toBe("PREFERRED_REQUIREMENT");
    expect(communication[0]?.kind).toBe("SOFT_SKILL");
  });

  it("collapses duplicate requirement lines and explains the decision", () => {
    const items = extractRequirements("TypeScript is required.\nTypeScript is required.");
    expect(items.filter((item) => /typescript/i.test(item.text))).toHaveLength(1);
    const explanation = explainQualification(
      [{ kind: "TECHNOLOGY", text: "TypeScript", required: true, role: "HARD_REQUIREMENT" }],
      [{ requirement: "TypeScript", evidence: "ProspectPilot uses TypeScript", source: "repository", match: "DIRECT", confidence: 0.9, reason: "Verified evidence names typescript." }],
    );
    expect(explanation.direct[0]?.evidence).toBe("ProspectPilot uses TypeScript");
    expect(explanation.state).toBe("REVIEW");
  });
});
