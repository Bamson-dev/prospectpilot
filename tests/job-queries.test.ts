import { describe, expect, it } from "vitest";
import { explicitTargetRoles } from "@/lib/applications/job-queries";

describe("explicitTargetRoles", () => {
  it("lowercases, trims, and removes duplicates", () => {
    expect(explicitTargetRoles(["Growth Marketing ", "growth  marketing", "Demand Generation"])).toEqual(["growth marketing", "demand generation"]);
  });

  it("drops empty or oversized entries and caps the list", () => {
    const many = Array.from({ length: 30 }, (_, index) => `role number ${index}`);
    expect(explicitTargetRoles(["", "ab", "x".repeat(200)])).toEqual([]);
    expect(explicitTargetRoles(many)).toHaveLength(12);
  });

  it("returns an empty list when no roles are set", () => {
    expect(explicitTargetRoles(null)).toEqual([]);
    expect(explicitTargetRoles(undefined)).toEqual([]);
  });
});

import { titleMatchesQuery } from "@/lib/applications/job-queries";

describe("titleMatchesQuery", () => {
  it("needs the subject words, not just the word manager", () => {
    expect(titleMatchesQuery("Senior Product Marketing Manager", "marketing manager")).toBe(true);
    expect(titleMatchesQuery("Associate Renewals Manager", "marketing manager")).toBe(false);
    expect(titleMatchesQuery("Engineering Manager - Data Platform", "marketing manager")).toBe(false);
  });

  it("requires every subject word for multi-word roles", () => {
    expect(titleMatchesQuery("Growth Marketing Lead", "growth marketing manager")).toBe(true);
    expect(titleMatchesQuery("Marketing Operations Manager", "growth marketing manager")).toBe(false);
    expect(titleMatchesQuery("Go-To-Market Manager, EMEA", "go-to-market manager")).toBe(true);
  });

  it("accepts anything when the query has no usable words", () => {
    expect(titleMatchesQuery("Anything", "a b")).toBe(true);
  });
});
