import { describe, expect, it, vi } from "vitest";
import { recordCompanyVerification } from "@/lib/compliance/record-verification";

const register = (body: unknown, status = 200) => async () => ({ ok: status === 200, status, json: async () => body });
const active = { company_number: "10876199", company_name: "CLICKSLICE LIMITED", company_status: "active", type: "ltd" };

function db(existing: unknown = { salesIntelligence: { angle: "keep" }, domain: "clickslice.co.uk" }) {
  return { prospect: { findUnique: vi.fn(async () => existing as never), update: vi.fn(async () => ({})) } };
}
const input = { prospectId: "p1", companyNumber: "10876199", confirmedDomain: "ClickSlice.co.uk", domainEvidence: "Website footer names the company number", apiKey: "k", now: new Date("2026-10-10T00:00:00Z") };

describe("recordCompanyVerification", () => {
  it("stores the register result and keeps other sales data", async () => {
    const d = db();
    const v = await recordCompanyVerification(d, register(active), input);
    expect(v).toMatchObject({ companyNumber: "10876199", companyStatus: "active", confirmedDomain: "clickslice.co.uk", checkedAt: "2026-10-10T00:00:00.000Z" });
    expect(d.prospect.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { salesIntelligence: { angle: "keep", companyVerification: v } } });
  });
  it("records an inactive company as returned so the sender refuses it", async () => {
    const v = await recordCompanyVerification(db(), register({ ...active, company_status: "dissolved" }), input);
    expect(v.companyStatus).toBe("dissolved");
  });
  it("writes nothing without an API key, for an unknown company, on an API error, or with weak evidence", async () => {
    for (const [fetchImpl, overrides, message] of [
      [register(active), { apiKey: undefined }, "COMPANIES_HOUSE_API_KEY"],
      [register({}, 404), {}, "no company"],
      [register({}, 500), {}, "500"],
      [register(active), { domainEvidence: "short" }, "evidence"],
      [register(active), { confirmedDomain: "not a domain" }, "domain"],
    ] as const) {
      const d = db();
      await expect(recordCompanyVerification(d, fetchImpl, { ...input, ...overrides })).rejects.toThrow(message);
      expect(d.prospect.update).not.toHaveBeenCalled();
    }
  });
  it("fails when the prospect is missing", async () => {
    await expect(recordCompanyVerification(db(null), register(active), input)).rejects.toThrow("not found");
  });
});
