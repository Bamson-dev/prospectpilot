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
