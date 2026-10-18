import { describe, expect, it } from "vitest";
import { classifyMarketingRole, isMarketingQuery, marketingSearchQueries, MARKETING_QUERIES } from "@/lib/applications/marketing-scope";

const marketingDescription = "You will own acquisition channels, paid media campaigns on Google Ads and Meta Ads, SEO and lifecycle email marketing. You report on CAC, ROAS and funnel conversion, and you manage the marketing budget and the marketing team.";
const gtmDescription = "Lead our go-to-market strategy. Own positioning and messaging, demand generation campaigns, paid acquisition channels, SEO and content marketing, and marketing analytics for the launch of each product.";
const salesDescription = "Carry a quota. Close deals with enterprise accounts, run outbound sales and cold calling, negotiate contracts, handle renewals and upsell the existing book of business. Commission paid monthly.";
const engineeringDescription = "Write clean code in the backend and frontend, own the codebase, run code reviews, deploy with CI/CD on Kubernetes, and join the on-call rotation. Strong unit tests and API design.";
const financeDescription = "Close the monthly books, own accounting, payroll and tax filings, and lead the finance team through the annual audit.";

describe("marketing scope accepts the target roles", () => {
  const accepted: Array<[string, string]> = [
    ["Growth Marketing Manager", marketingDescription],
    ["Performance Marketing Manager", marketingDescription],
    ["Product Marketing Manager", "Own product positioning and messaging, product launch plans, competitive intelligence and go-to-market collateral for each release."],
    ["Digital Marketing Lead", marketingDescription],
    ["Demand Generation Manager", marketingDescription],
    ["Head of Marketing", marketingDescription],
    ["Affiliate Marketing Manager", "Recruit and manage affiliate partners, set commission structures for the affiliate programme and report on affiliate campaigns, CAC and funnel conversion."],
    ["Marketing Operations Manager", "Run HubSpot and Marketo, marketing automation, lead scoring, attribution and campaign reporting for the marketing team."],
    ["Marketing-led GTM Manager", gtmDescription],
    ["Chief Marketing Officer (CMO)", marketingDescription],
    ["SEO Manager", "Own SEO strategy, technical SEO audits, content marketing and link building to grow organic acquisition."],
    ["Lifecycle Marketing Manager", marketingDescription],
    ["Brand Marketing Manager", "Own brand strategy, positioning, messaging and brand awareness campaigns."],
    ["Growth Strategist", gtmDescription],
    ["Developer Marketing Manager", marketingDescription],
    ["Product Marketing Manager, Software", marketingDescription],
  ];
  for (const [title, description] of accepted) {
    it(`accepts ${title}`, () => {
      const verdict = classifyMarketingRole({ title, description });
      expect(verdict.inScope, verdict.reason).toBe(true);
      expect(verdict.label).toBe("IN_SCOPE");
    });
  }
});

describe("marketing scope rejects unrelated roles by title", () => {
  const rejected = [
    "Software Engineering Manager",
    "Senior Software Developer",
    "Product Manager",
    "Technical Product Manager",
    "Sales Manager",
    "Business Development Manager",
    "Customer Success Manager",
    "IT Operations Manager",
    "General Operations Manager",
    "Project Manager",
    "Finance Manager",
    "Business Strategist",
    "DevOps Engineer",
    "Account Executive",
    "HR Manager",
    "Talent Acquisition Manager",
    "Supply Chain Manager",
    "Customer Support Lead",
    "Office Manager",
    "Growth Engineer",
    "Marketing Product Manager",
    "Marketing Finance Manager",
    "Software Product Manager",
    "Marketing Engineering Manager",
    "Marketing Intern",
    "Marketing Assistant",
    "Marketing Specialist",
  ];
  for (const title of rejected) {
    it(`rejects ${title} even with a marketing flavoured description`, () => {
      const verdict = classifyMarketingRole({ title, description: marketingDescription });
      expect(verdict.inScope, `${title}: ${verdict.reason}`).toBe(false);
      expect(verdict.label).toBe("OUT_OF_SCOPE");
      expect(verdict.reason.length).toBeGreaterThan(10);
    });
  }

  it("rejects a generic Growth Manager with no clear marketing function", () => {
    const verdict = classifyMarketingRole({ title: "Growth Manager", description: "Help the business grow. Work with teams across the company and report to the leadership team." });
    expect(verdict.inScope).toBe(false);
  });

  it("rejects a Sales Growth Manager whose description is sales work", () => {
    expect(classifyMarketingRole({ title: "Sales Growth Manager", description: salesDescription }).inScope).toBe(false);
  });

  it("rejects a Business Strategist even with strategy text", () => {
    expect(classifyMarketingRole({ title: "Business Strategist", description: "Advise the executive team on corporate strategy, M&A and long term planning." }).inScope).toBe(false);
  });

  it("keeps an unlisted title out of scope", () => {
    expect(classifyMarketingRole({ title: "Operations Lead", description: marketingDescription }).inScope).toBe(false);
  });
});

describe("marketing scope checks the description", () => {
  it("rejects a Marketing Manager title whose description is engineering work", () => {
    const verdict = classifyMarketingRole({ title: "Marketing Manager", description: engineeringDescription });
    expect(verdict.inScope).toBe(false);
  });

  it("rejects a Marketing Manager title whose description is sales work", () => {
    expect(classifyMarketingRole({ title: "Marketing Manager", description: salesDescription }).inScope).toBe(false);
  });

  it("rejects a Marketing Manager title whose description is finance work", () => {
    expect(classifyMarketingRole({ title: "Marketing Manager", description: financeDescription }).inScope).toBe(false);
  });

  it("rejects a Sales and Marketing Manager when the description is mostly sales", () => {
    expect(classifyMarketingRole({ title: "Sales and Marketing Manager", description: `${salesDescription} Some campaigns.` }).inScope).toBe(false);
  });

  it("rejects a Growth Manager when the description is sales", () => {
    expect(classifyMarketingRole({ title: "Growth Manager", description: salesDescription }).inScope).toBe(false);
  });

  it("accepts a Growth Manager whose description is clearly marketing", () => {
    expect(classifyMarketingRole({ title: "Growth Manager", description: marketingDescription }).inScope).toBe(true);
  });

  it("rejects an empty title", () => {
    expect(classifyMarketingRole({ title: "", description: marketingDescription }).inScope).toBe(false);
  });
});

describe("marketing search queries", () => {
  it("accepts marketing titles and refuses unrelated ones", () => {
    for (const query of ["growth marketing manager", "growth strategist", "go-to-market manager", "seo manager", "head of marketing"]) {
      expect(isMarketingQuery(query), query).toBe(true);
    }
    for (const query of ["manager", "strategist", "growth", "operations", "software engineer", "product manager", "founder", "technical product", "strategy and operations", "sales manager"]) {
      expect(isMarketingQuery(query), query).toBe(false);
    }
  });

  it("drops non-marketing saved roles", () => {
    const queries = marketingSearchQueries(["Growth Marketing Manager", "Software Engineer", "Product Manager", "Marketing Director"]);
    expect(queries).toEqual(["growth marketing manager", "marketing director"]);
  });

  it("falls back to the approved list when no saved role is a marketing title", () => {
    const queries = marketingSearchQueries(["Software Engineer", "Founder"]);
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) expect(isMarketingQuery(query)).toBe(true);
  });

  it("every approved query is a marketing query", () => {
    for (const query of MARKETING_QUERIES) expect(isMarketingQuery(query), query).toBe(true);
  });
});
