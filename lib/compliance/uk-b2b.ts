// UK B2B outreach safeguards. A UK recipient may be contacted only when the prospect is a company that
// the Companies House register shows as active and incorporated (limited company, plc or LLP), and a
// person has confirmed that the recipient domain belongs to that company. Sole traders and
// partnerships are not on this register and never qualify.

export type CompanyVerification = {
  companyNumber: string;
  companyName: string;
  companyStatus: string;
  companyType: string;
  checkedAt: string;
  domainConfirmed: boolean;
  confirmedDomain: string;
  domainEvidence: string;
};

const QUALIFYING_TYPES = new Set([
  "ltd",
  "plc",
  "llp",
  "private-limited-guarant-nsc",
  "private-limited-guarant-nsc-limited-exemption",
]);
const MAX_AGE_DAYS = 90;

export function isUkMarket(...values: Array<string | null | undefined>) {
  return values.some((value) => {
    const text = (value ?? "").trim().toLowerCase();
    return text === "uk" || text === "gb" || text === "united kingdom" || text === "great britain" || text === "england" || text === "scotland" || text === "wales" || text === "northern ireland";
  });
}

export function readCompanyVerification(salesIntelligence: unknown): CompanyVerification | null {
  if (!salesIntelligence || typeof salesIntelligence !== "object" || Array.isArray(salesIntelligence)) return null;
  const raw = (salesIntelligence as { companyVerification?: unknown }).companyVerification;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.companyNumber !== "string" || typeof v.companyStatus !== "string" || typeof v.companyType !== "string" || typeof v.checkedAt !== "string") return null;
  return {
    companyNumber: v.companyNumber,
    companyName: typeof v.companyName === "string" ? v.companyName : "",
    companyStatus: v.companyStatus,
    companyType: v.companyType,
    checkedAt: v.checkedAt,
    domainConfirmed: v.domainConfirmed === true,
    confirmedDomain: typeof v.confirmedDomain === "string" ? v.confirmedDomain.trim().toLowerCase() : "",
    domainEvidence: typeof v.domainEvidence === "string" ? v.domainEvidence : "",
  };
}

export type UkEligibility = { eligible: true } | { eligible: false; reason: string };

export function ukCompanyEligibility(evidence: CompanyVerification | null, recipientEmail: string, now = new Date()): UkEligibility {
  if (!evidence) return { eligible: false, reason: "UK recipient has no Companies House verification." };
  if (!/^[A-Z0-9]{8}$/.test(evidence.companyNumber)) return { eligible: false, reason: "Company number is not valid." };
  if (evidence.companyStatus !== "active") return { eligible: false, reason: "The company is not active on the register." };
  if (!QUALIFYING_TYPES.has(evidence.companyType)) return { eligible: false, reason: "The company type is not a qualifying corporate subscriber." };
  const checked = Date.parse(evidence.checkedAt);
  if (!Number.isFinite(checked) || now.getTime() - checked > MAX_AGE_DAYS * 86_400_000) return { eligible: false, reason: "The company verification is older than 90 days." };
  if (!evidence.domainConfirmed || evidence.domainEvidence.trim().length < 10 || !evidence.confirmedDomain) return { eligible: false, reason: "No one has confirmed that the recipient domain belongs to this company." };
  const domain = recipientEmail.split("@")[1]?.trim().toLowerCase() ?? "";
  if (!domain || (domain !== evidence.confirmedDomain && !domain.endsWith(`.${evidence.confirmedDomain}`))) {
    return { eligible: false, reason: "The recipient email domain does not match the domain confirmed for this company." };
  }
  return { eligible: true };
}

type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export async function lookupCompaniesHouse(fetchImpl: FetchLike, companyNumber: string, apiKey: string): Promise<Pick<CompanyVerification, "companyNumber" | "companyName" | "companyStatus" | "companyType"> | null> {
  const number = companyNumber.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(number)) throw new Error("Company number must be 8 characters.");
  const res = await fetchImpl(`https://api.company-information.service.gov.uk/company/${number}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Companies House lookup failed with status ${res.status}.`);
  const body = (await res.json()) as Record<string, unknown>;
  if (typeof body.company_number !== "string" || typeof body.company_status !== "string" || typeof body.type !== "string") {
    throw new Error("Companies House returned an unexpected response.");
  }
  return {
    companyNumber: body.company_number,
    companyName: typeof body.company_name === "string" ? body.company_name : "",
    companyStatus: body.company_status,
    companyType: body.type,
  };
}

export type SenderIdentity = { legalName: string; postalAddress: string; contactEmail: string };

export function senderIdentityFromEnv(env: Record<string, string | undefined> = process.env): SenderIdentity | null {
  const legalName = env.OUTREACH_SENDER_LEGAL_NAME?.trim();
  const postalAddress = env.OUTREACH_SENDER_ADDRESS?.trim();
  const contactEmail = env.OUTREACH_REPLY_EMAIL?.trim();
  if (!legalName || !postalAddress || !contactEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) return null;
  return { legalName, postalAddress, contactEmail };
}

export function buildOutreachFooter(input: { sender: SenderIdentity; recipientCompany: string; sourceHost: string | null; unsubscribeUrl: string }) {
  const why = input.sourceHost
    ? `You are receiving this one-off message because a business address for ${input.recipientCompany} is published on ${input.sourceHost}, and we think our services may be relevant to your company.`
    : `You are receiving this one-off message because we think our services may be relevant to ${input.recipientCompany}.`;
  const text = [
    "--",
    `${input.sender.legalName}, ${input.sender.postalAddress}`,
    `Contact: ${input.sender.contactEmail}`,
    why,
    `To stop all further emails from us, use this link: ${input.unsubscribeUrl}`,
    "You can also write to the contact address above to ask what data we hold about you, to object to its use, or to ask us to delete it.",
  ].join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = [
    "<hr/>",
    `<p style="font-size:12px;color:#555">${esc(input.sender.legalName)}, ${esc(input.sender.postalAddress)}<br/>`,
    `Contact: ${esc(input.sender.contactEmail)}<br/>`,
    `${esc(why)}<br/>`,
    `<a href="${esc(input.unsubscribeUrl)}">Unsubscribe</a> to end all further emails.<br/>`,
    "You can also write to the contact address above to ask what data we hold about you, to object to its use, or to ask us to delete it.</p>",
  ].join("");
  return { text, html };
}

// Contacts collected from public websites are scraped data. Brevo and Resend prohibit scraped lists in
// their written policies, and a personal Gmail account cannot authenticate a business domain. A provider
// may carry these contacts only after an operator lists it in OUTREACH_PROSPECTING_PROVIDERS, which is
// empty by default. Contacts with a recorded consent source are not affected.
const CONSENT_SOURCES = new Set(["opt-in", "customer", "referral-consent"]);

export function providerMayCarryContact(provider: string, contactSource: string, env: Record<string, string | undefined> = process.env) {
  if (CONSENT_SOURCES.has(contactSource.trim().toLowerCase())) return true;
  const allowed = (env.OUTREACH_PROSPECTING_PROVIDERS ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  return allowed.includes(provider.trim().toUpperCase());
}
