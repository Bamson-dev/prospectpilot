import type { CandidateRecord, CareerProfile } from "@/lib/applications/types";
import { writingRules } from "@/lib/applications/writing";

export const PLACEHOLDER_EMAIL = "needs-email@invalid.test";

const TECH: CareerProfile[] = ["SOFTWARE", "WEB", "SAAS", "HYBRID"];
const GROWTH: CareerProfile[] = ["MARKETING", "GROWTH", "FOUNDER", "SAAS", "HYBRID"];
const ALL: CareerProfile[] = ["SOFTWARE", "WEB", "MARKETING", "SAAS", "GROWTH", "FOUNDER", "HYBRID"];

const STACK = ["TypeScript", "Next.js", "React", "PostgreSQL", "Prisma", "Redis", "BullMQ", "Playwright", "Python", "Tailwind", "Scrapy"];

export const CAREER_PROFILES: Array<{
  kind: CareerProfile;
  title: string;
  summary: string;
  headline: string;
  summaryStrategy: string;
  projectOrder: string[];
  preferredTechnologies: string[];
  excluded: string[];
  targetTitles: string[];
}> = [
  { kind: "SOFTWARE", title: "Software Engineer", headline: "Software Engineer", summary: "Full-stack evidence is limited to technologies and architecture verified in ProspectPilot.", summaryStrategy: "Lead with ProspectPilot. Do not copy technologies from the vacancy.", projectOrder: ["ProspectPilot"], preferredTechnologies: STACK, excluded: ["$1.5 million", "100,000"], targetTitles: ["Software Engineer", "Full Stack Developer", "Backend Developer"] },
  { kind: "WEB", title: "Web Developer", headline: "Web Developer", summary: "Web evidence is the ProspectPilot web application. Visual-design tools are not on file.", summaryStrategy: "Use the verified web application. Do not add design-tool names.", projectOrder: ["ProspectPilot"], preferredTechnologies: STACK, excluded: ["WordPress", "Figma", "Webflow", "Shopify"], targetTitles: ["Web Developer", "Web Designer", "Frontend Developer"] },
  { kind: "SAAS", title: "Product Engineer", headline: "Product Engineer", summary: "Product evidence is ProspectPilot's web and worker product, plus PromptEarn product operations where those facts are non-technical.", summaryStrategy: "Put the product record first. Keep PromptEarn non-technical.", projectOrder: ["ProspectPilot"], preferredTechnologies: STACK, excluded: [], targetTitles: ["Product Engineer", "SaaS Engineer"] },
  { kind: "MARKETING", title: "Growth Marketer", headline: "Growth Marketer", summary: "Growth and affiliate evidence comes from the PromptEarn founder record.", summaryStrategy: "Use PromptEarn growth evidence. Leave the software stack off unless the vacancy names a verified technology.", projectOrder: [], preferredTechnologies: [], excluded: STACK, targetTitles: ["Growth Marketer", "Performance Marketing Manager", "Digital Marketing Manager"] },
  { kind: "GROWTH", title: "Growth and GTM", headline: "Growth and GTM", summary: "Go-to-market, acquisition, and partnership evidence comes from the PromptEarn founder record.", summaryStrategy: "Use go-to-market and partnership evidence from PromptEarn.", projectOrder: [], preferredTechnologies: [], excluded: STACK, targetTitles: ["GTM Manager", "Head of Growth", "Acquisition Manager"] },
  { kind: "FOUNDER", title: "Founder", headline: "Founder", summary: "Founder evidence is ownership of PromptEarn, including users, revenue, and platform operations from the candidate brief.", summaryStrategy: "Use founder ownership facts only.", projectOrder: [], preferredTechnologies: [], excluded: [], targetTitles: ["Founder"] },
  { kind: "HYBRID", title: "Technical and Growth", headline: "Technical and Growth", summary: "This presentation uses ProspectPilot for technical evidence and PromptEarn for growth evidence. It does not merge unverified stacks into either.", summaryStrategy: "Keep ProspectPilot technical facts and PromptEarn growth facts in separate sections.", projectOrder: ["ProspectPilot"], preferredTechnologies: STACK, excluded: [], targetTitles: ["Growth Engineer"] },
];

export function careerStrategy(kind: CareerProfile) {
  return CAREER_PROFILES.find((profile) => profile.kind === kind);
}

export function contactIsReady(email: string | null | undefined) {
  return Boolean(email && !email.endsWith("@invalid.test"));
}

export function selectExistingCandidate<T extends { email: string; applicationCount: number }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return rows.find((row) => row.applicationCount > 0) ?? rows.find((row) => contactIsReady(row.email)) ?? rows[0];
}

export function unknownCandidateFields() {
  return ["phone", "location", "linkedin", "education", "certifications", "work authorization", "notice period", "salary expectation"];
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
  const prospectStack = ["TypeScript", "Next.js", "React", "PostgreSQL", "Prisma", "Redis", "BullMQ", "Playwright", "Python", "Tailwind", "Scrapy"];
  return {
    fullName: "Bamidele Matthew",
    firstName: "Bamidele",
    lastName: "Matthew",
    email: PLACEHOLDER_EMAIL,
    phone: null,
    location: null,
    facts: [
      ...promptEarn.map((fact, index) => ({
        id: `prompt-${index}`,
        category: fact.includes("100,000") || fact.includes("$1.5") || fact.includes("1.5") ? "METRIC" as const : "EXPERIENCE" as const,
        fact,
        verified: true,
        profiles: GROWTH,
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
      ...prospectStack.map((tech, index) => ({
        id: `tech-${index}`,
        category: "TECHNOLOGY" as const,
        fact: `ProspectPilot uses ${tech}`,
        verified: true,
        profiles: TECH,
        technologies: [tech],
        skills: [tech],
      })),
      {
        id: "arch-web",
        category: "PROJECT",
        fact: "ProspectPilot has a Next.js web application and a separate worker process.",
        verified: true,
        profiles: TECH,
        keywords: ["web", "worker"],
      },
      {
        id: "arch-data",
        category: "PROJECT",
        fact: "ProspectPilot stores application data in PostgreSQL through Prisma and runs background work on Redis and BullMQ.",
        verified: true,
        profiles: TECH,
        keywords: ["postgresql", "queue"],
      },
      {
        id: "arch-fetch",
        category: "PROJECT",
        fact: "ProspectPilot can fetch public pages with Playwright and includes a Scrapy crawl path.",
        verified: true,
        profiles: TECH,
        keywords: ["playwright", "scrapy"],
      },
    ],
    experiences: [
      {
        id: "exp-prompt",
        title: "Founder",
        organizationName: "PromptEarn",
        summary: "Founder and CMO of PromptEarn. The verified record covers affiliate growth, acquisition, CRM workflows, automated payouts, digital education, product development, monetization, and go-to-market work. No PromptEarn programming stack is on file.",
        verified: true,
        profiles: GROWTH,
      },
    ],
    projects: [
      {
        id: "proj-prospect",
        name: "ProspectPilot",
        description: "Prospect discovery, company research, qualification, and outreach product, with a web application and a worker.",
        role: "Builder",
        technologies: prospectStack,
        features: ["discovery", "research", "qualification", "outreach", "queues", "organization-scoped access"],
        outcomes: ["Production web and worker deployment"],
        metrics: [],
        verified: true,
        profiles: TECH,
        url: "https://leadpilot.live",
        githubUrl: "https://github.com/Bamson-dev/prospectpilot",
        source: "prospectpilot-repository",
        confidence: 90,
      },
      ...["LeadThur", "DigitalSkillX", "Adley", "E-commerce Platform with CRM", "Crypto Investment Platform", "AI Chat Application", "Pdigital Studio"].map((name, index) => ({
        id: `proj-${index}`,
        name,
        description: "Named in the candidate brief. Role details, dates, technologies, users, and revenue are not verified yet.",
        role: "Listed by the candidate",
        technologies: [] as string[],
        features: [] as string[],
        outcomes: [] as string[],
        metrics: [] as string[],
        verified: true,
        profiles: [] as CareerProfile[],
        source: "operator-supplied candidate brief",
        confidence: 40,
      })),
    ],
  };
}

export function seedWritingProfile() {
  return writingRules();
}
