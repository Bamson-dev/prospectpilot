import { describe, expect, it } from "vitest";
import { applicationBody, applicationSubject, findApplicationEmail } from "@/lib/applications/email-route";

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
