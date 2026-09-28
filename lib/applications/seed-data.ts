import type { CandidateRecord, CareerProfile } from "@/lib/applications/types";

export const PLACEHOLDER_EMAIL = "needs-email@invalid.test";

const ALL: CareerProfile[] = ["SOFTWARE", "WEB", "MARKETING"];

export function contactIsReady(email: string | null | undefined) {
  return Boolean(email && !email.endsWith("@invalid.test"));
}

export function seedCandidateRecord(): CandidateRecord {
  const promptEarn = [
    "Founder of PromptEarn",
    "PromptEarn founder and CMO experience",
    "PromptEarn reached 100,000+ affiliates or users",
    "PromptEarn cumulative platform revenue exceeded $1.5 million",
    "PromptEarn includes affiliate infrastructure",
    "PromptEarn includes automated payout systems",
    "PromptEarn includes CRM workflows",
    "PromptEarn includes growth systems",
    "PromptEarn includes digital education",
    "PromptEarn includes affiliate marketing",
    "PromptEarn includes platform operations",
    "PromptEarn includes product development",
    "PromptEarn includes monetization work",
    "PromptEarn includes acquisition systems",
    "PromptEarn includes go-to-market strategy",
  ];
  return {
    fullName: "Bamidele Matthew",
    firstName: "Bamidele",
    lastName: "Matthew",
    email: PLACEHOLDER_EMAIL,
    location: null,
    facts: [
      ...promptEarn.map((fact, index) => ({
        id: `prompt-${index}`,
        category: fact.includes("100,000") || fact.includes("1.5") ? "METRIC" as const : "EXPERIENCE" as const,
        fact,
        verified: true,
        profiles: ["MARKETING"] as CareerProfile[],
        keywords: ["PromptEarn", "growth", "affiliate"],
      })),
      {
        id: "breadth",
        category: "EXPERIENCE",
        fact: "Experience across software, web products, SaaS, digital products, marketing, growth, advertising, product development, entrepreneurship, and business operations.",
        verified: true,
        profiles: ALL,
        keywords: ["software", "marketing", "product"],
      },
      ...["TypeScript", "Next.js", "React", "PostgreSQL", "Prisma", "Redis", "BullMQ", "Playwright", "Python"].map((tech, index) => ({
        id: `tech-${index}`,
        category: "TECHNOLOGY" as const,
        fact: `ProspectPilot uses ${tech}`,
        verified: true,
        profiles: ["SOFTWARE", "WEB"] as CareerProfile[],
        technologies: [tech],
        skills: [tech],
      })),
    ],
    experiences: [
      {
        id: "exp-prompt",
        title: "Founder",
        organizationName: "PromptEarn",
        summary: "Founder and CMO of PromptEarn, covering affiliate growth, acquisition, CRM workflows, automated payouts, digital education, product development, monetization, and go-to-market work.",
        verified: true,
        profiles: ["MARKETING"],
      },
    ],
    projects: [
      {
        id: "proj-prospect",
        name: "ProspectPilot",
        description: "Prospect discovery, company research, qualification, and outreach platform.",
        role: "Builder",
        technologies: ["TypeScript", "Next.js", "React", "PostgreSQL", "Prisma", "Redis", "BullMQ", "Playwright", "Python"],
        features: ["discovery", "research", "qualification", "outreach", "queues"],
        outcomes: ["Production web and worker deployment"],
        metrics: [],
        verified: true,
        profiles: ["SOFTWARE", "WEB"],
      },
      ...["LeadThur", "DigitalSkillX", "Adley", "E-commerce Platform with CRM", "Crypto Investment Platform", "AI Chat Application", "Pdigital Studio"].map((name, index) => ({
        id: `proj-${index}`,
        name,
        description: "Named in the candidate brief. Features, dates, and technologies are not verified yet.",
        role: "Listed by the candidate",
        technologies: [] as string[],
        features: [] as string[],
        outcomes: [] as string[],
        metrics: [] as string[],
        verified: true,
        profiles: ["SOFTWARE", "WEB"] as CareerProfile[],
      })),
    ],
  };
}
