import { describe, expect, it } from "vitest";
import { buildOutreachFooter, isUkMarket, lookupCompaniesHouse, providerMayCarryContact, readCompanyVerification, senderIdentityFromEnv, ukCompanyEligibility } from "@/lib/compliance/uk-b2b";

const good = { companyNumber: "10876199", companyName: "CLICKSLICE LIMITED", companyStatus: "active", companyType: "ltd", checkedAt: "2026-10-10T00:00:00Z", domainConfirmed: true, confirmedDomain: "clickslice.co.uk", domainEvidence: "Footer of the website names the company and number" };
const to = "info@clickslice.co.uk";
const now = new Date("2026-10-20T00:00:00Z");

describe("UK market detection", () => {
  it("recognises UK values and ignores others", () => {
    expect(isUkMarket(null, "United Kingdom")).toBe(true);
    expect(isUkMarket("GB")).toBe(true);
    expect(isUkMarket("Nigeria", "South Africa", undefined)).toBe(false);
  });
});

describe("UK company eligibility", () => {
  it("accepts a verified active limited company", () => {
    expect(ukCompanyEligibility(good, to, now)).toEqual({ eligible: true });
  });
  it("rejects missing evidence, inactive, wrong type, stale, and unconfirmed domain", () => {
    expect(ukCompanyEligibility(null, to, now).eligible).toBe(false);
    expect(ukCompanyEligibility({ ...good, companyStatus: "dissolved" }, to, now).eligible).toBe(false);
    expect(ukCompanyEligibility({ ...good, companyType: "registered-society-non-jurisdictional" }, to, now).eligible).toBe(false);
    expect(ukCompanyEligibility({ ...good, checkedAt: "2026-01-01T00:00:00Z" }, to, now).eligible).toBe(false);
    expect(ukCompanyEligibility({ ...good, domainConfirmed: false }, to, now).eligible).toBe(false);
    expect(ukCompanyEligibility({ ...good, domainEvidence: "" }, to, now).eligible).toBe(false);
    expect(ukCompanyEligibility({ ...good, companyNumber: "123" }, to, now).eligible).toBe(false);
  });
  it("rejects a recipient whose domain differs from the confirmed domain", () => {
    expect(ukCompanyEligibility(good, "info@other.co.uk", now)).toEqual({ eligible: false, reason: "The recipient email domain does not match the domain confirmed for this company." });
    expect(ukCompanyEligibility(good, "a@mail.clickslice.co.uk", now)).toEqual({ eligible: true });
    expect(ukCompanyEligibility(good, "a@evilclickslice.co.uk", now).eligible).toBe(false);
    expect(ukCompanyEligibility({ ...good, confirmedDomain: "" }, to, now).eligible).toBe(false);
  });
  it("reads evidence only from the companyVerification key", () => {
    expect(readCompanyVerification({ companyVerification: good })).toEqual(good);
    expect(readCompanyVerification({ other: 1 })).toBeNull();
    expect(readCompanyVerification(null)).toBeNull();
    expect(readCompanyVerification([good])).toBeNull();
  });
});

describe("Companies House lookup", () => {
  const key = "test-key";
  it("returns the register fields and sends the key as basic auth", async () => {
    let auth = "";
    const result = await lookupCompaniesHouse(async (_u, init) => { auth = init.headers.Authorization; return { ok: true, status: 200, json: async () => ({ company_number: "10876199", company_name: "X LTD", company_status: "active", type: "ltd" }) }; }, "10876199", key);
    expect(result?.companyStatus).toBe("active");
    expect(auth).toBe(`Basic ${Buffer.from("test-key:").toString("base64")}`);
  });
  it("returns null for 404 and throws for other failures and bad numbers", async () => {
    expect(await lookupCompaniesHouse(async () => ({ ok: false, status: 404, json: async () => ({}) }), "10876199", key)).toBeNull();
    await expect(lookupCompaniesHouse(async () => ({ ok: false, status: 500, json: async () => ({}) }), "10876199", key)).rejects.toThrow("500");
    await expect(lookupCompaniesHouse(async () => ({ ok: true, status: 200, json: async () => ({}) }), "10876199", key)).rejects.toThrow("unexpected");
    await expect(lookupCompaniesHouse(async () => ({ ok: true, status: 200, json: async () => ({}) }), "12", key)).rejects.toThrow("8 characters");
  });
});

describe("sender identity and footer", () => {
  it("requires every identity field", () => {
    expect(senderIdentityFromEnv({})).toBeNull();
    expect(senderIdentityFromEnv({ OUTREACH_SENDER_LEGAL_NAME: "A Ltd", OUTREACH_SENDER_ADDRESS: "1 High St, London", OUTREACH_REPLY_EMAIL: "bad" })).toBeNull();
    expect(senderIdentityFromEnv({ OUTREACH_SENDER_LEGAL_NAME: "A Ltd", OUTREACH_SENDER_ADDRESS: "1 High St, London", OUTREACH_REPLY_EMAIL: "hi@a.co.uk" })).toEqual({ legalName: "A Ltd", postalAddress: "1 High St, London", contactEmail: "hi@a.co.uk" });
  });
  it("names the sender, reason, address, contact and opt-out, and escapes html", () => {
    const f = buildOutreachFooter({ sender: { legalName: "A Ltd", postalAddress: "1 High St, London", contactEmail: "hi@a.co.uk" }, recipientCompany: "Evil <b>Co</b>", sourceHost: "example.co.uk", unsubscribeUrl: "https://x.test/unsubscribe?token=t" });
    for (const part of ["A Ltd", "1 High St, London", "hi@a.co.uk", "example.co.uk", "https://x.test/unsubscribe?token=t", "object to its use"]) expect(f.text).toContain(part);
    expect(f.html).toContain("&lt;b&gt;");
    expect(f.html).not.toContain("<b>Co");
    expect(f.html).toContain('href="https://x.test/unsubscribe?token=t"');
  });
});

describe("provider policy for scraped contacts", () => {
  it("blocks website-sourced contacts unless the provider is explicitly allowed", () => {
    expect(providerMayCarryContact("GMAIL", "website", {})).toBe(false);
    expect(providerMayCarryContact("RESEND", "website", { OUTREACH_PROSPECTING_PROVIDERS: "" })).toBe(false);
    expect(providerMayCarryContact("RESEND", "website", { OUTREACH_PROSPECTING_PROVIDERS: "smtp-x, resend" })).toBe(true);
    expect(providerMayCarryContact("GMAIL", "opt-in", {})).toBe(true);
  });
});
