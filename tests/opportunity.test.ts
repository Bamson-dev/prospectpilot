import { describe, expect, it } from "vitest";
import { buildCvDraft } from "@/lib/applications/cv";
import { scoreJobFit } from "@/lib/applications/fit";
import { assessVacancy } from "@/lib/applications/job-pipeline";
import {
  applicationQueueDecision,
  classifyLanes,
  evaluateOpportunity,
  PROFILE_EVIDENCE_MAP,
  supportedOpportunityProfiles,
} from "@/lib/applications/opportunity";
import { extractRequirements } from "@/lib/applications/requirements";
import { seedCandidateRecord } from "@/lib/applications/seed-data";
import type { CandidateRecord, ExtractedRequirement, JobInput } from "@/lib/applications/types";

const seed = seedCandidateRecord();

function job(title: string, description: string): JobInput {
  return { title, companyName: "Example", description, applicationUrl: "https://jobs.example/role" };
}

function person(facts: string[]): CandidateRecord {
  return {
    ...seed,
    facts: facts.map((fact, index) => ({
      id: `f-${index}`,
      category: "EXPERIENCE" as const,
      fact,
      verified: true,
      profiles: ["SOFTWARE", "WEB", "SAAS", "MARKETING", "GROWTH", "FOUNDER", "HYBRID"],
    })),
    projects: [],
    experiences: [],
  };
}

function hard(text: string): ExtractedRequirement {
  return { kind: "MUST_HAVE", text, required: true, role: "HARD_REQUIREMENT" };
}

describe("opportunity coverage", () => {
  it("classifies career lanes and keeps several profiles available for one vacancy", () => {
    expect(classifyLanes(job("Technical Product Manager", "Own the product."))).toEqual(expect.arrayContaining(["Product", "Engineering"]));
    expect(classifyLanes(job("Growth Marketing Manager", "Own acquisition."))).toEqual(expect.arrayContaining(["Growth", "Marketing"]));
    expect(classifyLanes(job("Technical Project Manager", "Deliver the rollout."))).toEqual(expect.arrayContaining(["Project Management", "Engineering"]));
    const report = evaluateOpportunity({ job: job("Technical Product Manager", "Own product development."), candidate: seed, requirements: [] });
    expect(report.primaryProfile).toBe("TECHNICAL_PRODUCT_MANAGER");
    expect(report.secondaryProfiles).toEqual(expect.arrayContaining(["PRODUCT_ENGINEER", "TECHNICAL_GROWTH"]));
    expect(report.documentProfile).toBe("SAAS");
    expect(report.decision).toBe("APPLY");
    expect(report.queue).toBe("prepare");
    expect(report.experienceBased[0]?.reason).toMatch(/no mandatory blocker/i);
    const architect = evaluateOpportunity({
      job: job("Staff Product Security Architect", "Lead security architecture and mentor engineers."),
      candidate: seed,
      requirements: [],
    });
    expect(architect.decision).toBe("APPLY");
    const fullStack = evaluateOpportunity({
      job: job("Senior Full-Stack Engineer", "Builds web applications, APIs, databases, frontend and backend systems."),
      candidate: seed,
      requirements: [],
    });
    expect(fullStack.decision).toBe("APPLY");
    expect(fullStack.primaryProfile).toBeTruthy();
  });

  it("activates a profile only from verified evidence", () => {
    const supported = supportedOpportunityProfiles(seed);
    expect(supported).toEqual(expect.arrayContaining([
      "SOFTWARE_ENGINEER",
      "WEB_DEVELOPER",
      "PRODUCT_ENGINEER",
      "PRODUCT_MANAGER",
      "GROWTH_MARKETER",
      "GROWTH_GTM",
      "TECHNICAL_GROWTH",
      "FOUNDER",
    ]));
    expect(supported).not.toContain("PROJECT_MANAGER");
    expect(supported).not.toContain("FINTECH");
    expect(supported).not.toContain("ECOMMERCE");
    expect(supported).not.toContain("BUSINESS_DEVELOPMENT");
    expect(supportedOpportunityProfiles(person(["Managed project delivery and stakeholder management."]))).toContain("PROJECT_MANAGER");
    expect(supportedOpportunityProfiles(person(["Business development for partner pipeline."]))).toContain("BUSINESS_DEVELOPMENT");
    expect(supportedOpportunityProfiles(person(["Platform operations and business strategy."]))).toContain("STRATEGY_OPERATIONS");
    expect(PROFILE_EVIDENCE_MAP.SOFTWARE_ENGINEER).toContain("programming languages");
    expect(PROFILE_EVIDENCE_MAP.GROWTH_MARKETER).toContain("affiliate growth");
    expect(PROFILE_EVIDENCE_MAP.FOUNDER).toContain("product ownership");
  });

  it("matches direct, transferable, adjacent, and experience-based evidence without inventing a title", () => {
    const direct = evaluateOpportunity({
      job: job("Software Engineer", "TypeScript"),
      candidate: seed,
      requirements: [hard("Experience with TypeScript and PostgreSQL.")],
    });
    expect(direct.decision).toBe("APPLY");
    expect(direct.direct.length).toBeGreaterThan(0);
    expect(direct.queue).toBe("prepare");

    const transferable = evaluateOpportunity({
      job: job("GTM Manager", "GTM"),
      candidate: person(["PromptEarn includes go-to-market strategy."]),
      requirements: [hard("GTM leadership")],
    });
    expect(transferable.transferable[0]?.reason).toMatch(/go-to-market/i);

    const adjacent = evaluateOpportunity({
      job: job("Performance Marketing Manager", "Ads"),
      candidate: person(["PromptEarn includes affiliate growth and paid advertising."]),
      requirements: [hard("Performance marketing experience")],
    });
    expect(adjacent.adjacent[0]?.reason).toMatch(/adjacent to performance marketing/i);
    expect(adjacent.decision).toBe("APPLY");

    const experience = evaluateOpportunity({
      job: job("Product Manager", "Own the product."),
      candidate: person(["Founder of PromptEarn. Product development and monetization."]),
      requirements: [hard("Product management experience")],
    });
    expect(experience.experienceBased[0]?.reason).toMatch(/no product-manager title/i);
    expect(experience.reason.toLowerCase()).not.toContain("previously worked as product manager");
    expect(experience.decision).toBe("APPLY");
    expect(experience.documentProfile).toBe("SAAS");
  });

  it("keeps stretch and unknown work in review, and blocks a real disqualifier", () => {
    const stretch = evaluateOpportunity({
      job: job("Strategy Manager", "Operations"),
      candidate: person(["Founder of a software product."]),
      requirements: [hard("Experience operating a multi-cluster fleet")],
    });
    expect(stretch.stretch.length).toBe(1);
    expect(stretch.decision).toBe("APPLY");

    const unknown = assessVacancy(job("Software Engineer", "Requirements\n5+ years of TypeScript."), seed);
    expect(unknown.state).toBe("APPLY");
    expect(unknown.opportunity.transferable[0]?.reason).toMatch(/transferable/i);

    const license = evaluateOpportunity({
      job: job("Clinician", "Care"),
      candidate: seed,
      requirements: [hard("Must hold a medical license.")],
    });
    expect(license.disqualifiers.length).toBe(1);
    expect(license.decision).toBe("NOT_A_FIT");
    expect(applicationQueueDecision("NOT_A_FIT")).toBe("hold");

    const node = evaluateOpportunity({
      job: job("Software Engineer", "Node"),
      candidate: person(["ProspectPilot uses Next.js."]),
      requirements: [hard("Node.js is required.")],
    });
    expect(node.decision).toBe("APPLY");
    expect(node.stretch[0]?.reason).toMatch(/stretch opportunity/i);
    const android = evaluateOpportunity({ job: job("Android Engineer", "Build mobile features."), candidate: seed, requirements: [] });
    expect(android.decision).toBe("NOT_A_FIT");
    const recruiting = evaluateOpportunity({ job: job("Director of Recruiting, Engineering", "Hire engineers."), candidate: seed, requirements: [] });
    expect(recruiting.decision).toBe("NOT_A_FIT");
  });

  it("does not treat a responsibility or a missing preference as a rejection", () => {
    const responsibilities = assessVacancy(job("Software Engineer", "You will build APIs.\nWork with cross-functional teams."), seed);
    expect(responsibilities.explanation.responsibilities.length).toBeGreaterThan(0);
    expect(responsibilities.state).not.toBe("NOT_A_FIT");
    const preferred = evaluateOpportunity({
      job: job("Software Engineer", "TypeScript"),
      candidate: seed,
      requirements: [
        hard("Experience with TypeScript."),
        { kind: "NICE_TO_HAVE", text: "GraphQL is preferred.", required: false, role: "PREFERRED_REQUIREMENT" },
        { kind: "RESPONSIBILITY", text: "Build APIs", required: false, role: "RESPONSIBILITY" },
      ],
    });
    expect(preferred.decision).toBe("APPLY");
    expect(preferred.missingPreferred.some((item) => /graphql/i.test(item))).toBe(true);
    expect(preferred.gaps).toContain("graphql experience is unknown");
    expect(preferred.disqualifiers).toEqual([]);
  });

  it("selects a profile-specific CV from verified evidence", () => {
    const software = assessVacancy(job("Software Engineer", "Build APIs with TypeScript and PostgreSQL."), seed);
    const marketing = assessVacancy(job("Growth Marketing Manager", "Own affiliate acquisition and go-to-market work."), seed);
    const founder = assessVacancy(job("Founder in Residence", "Build a company."), seed);
    expect(software.opportunity.documentProfile).toBe("SOFTWARE");
    expect(marketing.opportunity.documentProfile).toBe("MARKETING");
    expect(founder.opportunity.documentProfile).toBe("FOUNDER");
    const softwareJob = job("Software Engineer", "Build APIs with TypeScript and PostgreSQL.");
    const softwareCv = buildCvDraft(softwareJob, seed, scoreJobFit(softwareJob, seed, extractRequirements(softwareJob.description)));
    expect(softwareCv.headline).toMatch(/Software Engineer/);
    expect(softwareCv.text).toContain("ProspectPilot");
    expect(softwareCv.text).not.toContain("$1.5 million");
    const marketingFit = scoreJobFit(job("Growth Marketing Manager", "Own affiliate acquisition."), seed, extractRequirements("Own affiliate acquisition."));
    const marketingCv = buildCvDraft(job("Growth Marketing Manager", "Own affiliate acquisition."), seed, marketingFit);
    expect(marketingCv.headline).toMatch(/Growth/);
    expect(marketingCv.text).not.toContain("Tailwind");
  });
});
