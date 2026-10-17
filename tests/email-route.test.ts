import { describe, expect, it } from "vitest";
import { applicationBody, applicationSubject, findApplicationEmail, isBlockedApplicationMailbox } from "@/lib/applications/email-route";

const base = { companyName: "Northwind Digital", companyDomain: "northwind.io" };

describe("findApplicationEmail", () => {
  it("accepts an employer-domain address the posting names for applications", () => {
    const route = findApplicationEmail({ ...base, description: "Send your CV and cover letter to careers@northwind.io to apply." });
    expect(route.found).toBe(true);
    if (route.found) {
      expect(route.email).toBe("careers@northwind.io");
      expect(route.ownership).toBe("EMPLOYER_DOMAIN");
    }
  });

  it("accepts a designated recruiter address on another domain", () => {
    const route = findApplicationEmail({ ...base, description: "To apply, email your resume to jobs@talentpartners.co.uk." });
    expect(route.found).toBe(true);
    if (route.found) expect(route.ownership).toBe("POSTING_DESIGNATED");
  });

  it("ignores noreply, support and ATS addresses", () => {
    const route = findApplicationEmail({ ...base, description: "Apply by email: noreply@northwind.io or support@northwind.io or x@boards.greenhouse.io" });
    expect(route.found).toBe(false);
  });

  it("returns not found when no address exists", () => {
    expect(findApplicationEmail({ ...base, description: "Apply through our website form." }).found).toBe(false);
  });

  it("refuses an address with no application context", () => {
    expect(findApplicationEmail({ ...base, description: "Our founder is bob@northwind.io." }).found).toBe(false);
  });

  it("refuses when two unrelated addresses are named", () => {
    const route = findApplicationEmail({ ...base, description: "Send your CV to a@firm-one.com or send your CV to b@firm-two.com to apply." });
    expect(route.found).toBe(false);
  });
});

describe("recipient safety", () => {
  const refused = [
    "accessibility@northwind.io",
    "accommodations@northwind.io",
    "accommodation.requests@northwind.io",
    "reasonable-adjustments@northwind.io",
    "verification@northwind.io",
    "verify.candidates@northwind.io",
    "fraud@northwind.io",
    "report-scam@northwind.io",
    "privacy@northwind.io",
    "dataprotection@northwind.io",
    "dpo@northwind.io",
    "info@northwind.io",
    "hello@northwind.io",
  ];
  for (const address of refused) {
    it(`refuses ${address} even when the posting says apply`, () => {
      expect(isBlockedApplicationMailbox(address)).toBe(true);
      expect(findApplicationEmail({ ...base, description: `To apply, send your CV to ${address}.` }).found).toBe(false);
    });
  }

  it("refuses an accommodation address placed in the same sentence as apply", () => {
    const text = "If you need accommodation during the application process, email people-access@northwind.io.";
    expect(findApplicationEmail({ ...base, description: text }).found).toBe(false);
  });

  it("refuses an address in a questions or verification sentence", () => {
    expect(findApplicationEmail({ ...base, description: "Questions about the application? Email hr@northwind.io." }).found).toBe(false);
    expect(findApplicationEmail({ ...base, description: "To verify this vacancy is real, email hr@northwind.io." }).found).toBe(false);
  });

  it("refuses a loose mention of email without an application instruction", () => {
    expect(findApplicationEmail({ ...base, description: "Email us at hr@northwind.io about anything. We are a friendly team." }).found).toBe(false);
  });

  it("accepts the address in the sentence that tells candidates to apply", () => {
    const text = "Accessibility: we support reasonable adjustments.\nTo apply, email your CV to careers@northwind.io.";
    const route = findApplicationEmail({ ...base, description: text });
    expect(route.found).toBe(true);
    if (route.found) expect(route.email).toBe("careers@northwind.io");
  });

  it("accepts a send-your-CV instruction without the word apply", () => {
    const route = findApplicationEmail({ ...base, description: "Please send your CV and cover letter to hiring@northwind.io." });
    expect(route.found).toBe(true);
  });

  it("accepts a designated address on a free mail domain", () => {
    const route = findApplicationEmail({ ...base, description: "Interested candidates should apply by sending a CV to bright.hr.recruit@gmail.com" });
    expect(route.found).toBe(true);
  });

  it("does not let a safe address in one sentence hide a refused one in another", () => {
    const text = "Send your CV to careers@northwind.io. Report fraud to fraud@northwind.io.";
    const route = findApplicationEmail({ ...base, description: text });
    expect(route.found).toBe(true);
    if (route.found) expect(route.email).toBe("careers@northwind.io");
  });
});

describe("application message", () => {
  it("builds a role specific subject", () => {
    expect(applicationSubject("Growth Marketing Manager", "Ada Lovelace")).toBe("Application for Growth Marketing Manager - Ada Lovelace");
  });

  it("limits subject length", () => {
    expect(applicationSubject("A".repeat(300), "Ada").length).toBeLessThanOrEqual(150);
  });

  it("adds the attachment line and contact footer", () => {
    const body = applicationBody({ letter: "Dear team,\n\nHello.", fullName: "Ada Lovelace", email: "ada@example.com", phone: "+1 555 0100" });
    expect(body).toContain("attached as PDF files");
    expect(body).toContain("ada@example.com");
    expect(body).toContain("+1 555 0100");
  });
});
