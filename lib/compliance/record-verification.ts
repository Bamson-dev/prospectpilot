import { lookupCompaniesHouse, type CompanyVerification } from "@/lib/compliance/uk-b2b";

type Db = {
  prospect: {
    findUnique(args: { where: { id: string }; select: { salesIntelligence: true; domain: true } }): Promise<{ salesIntelligence: unknown; domain: string | null } | null>;
    update(args: { where: { id: string }; data: { salesIntelligence: object } }): Promise<unknown>;
  };
};

type Fetch = Parameters<typeof lookupCompaniesHouse>[0];

// Looks the company up on the Companies House API and stores the register result together with the
// operator's evidence that the domain belongs to the company. It never marks a company verified
// without an API response, and it stores the register status as returned, even when not active.
export async function recordCompanyVerification(
  db: Db,
  fetchImpl: Fetch,
  input: { prospectId: string; companyNumber: string; confirmedDomain: string; domainEvidence: string; apiKey: string | undefined; now?: Date },
): Promise<CompanyVerification> {
  if (!input.apiKey) throw new Error("COMPANIES_HOUSE_API_KEY is not set. No verification was recorded.");
  const domain = input.confirmedDomain.trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error("Confirmed domain is not valid.");
  if (input.domainEvidence.trim().length < 10) throw new Error("Describe the evidence that links the domain to the company.");
  const prospect = await db.prospect.findUnique({ where: { id: input.prospectId }, select: { salesIntelligence: true, domain: true } });
  if (!prospect) throw new Error("Prospect was not found.");
  const register = await lookupCompaniesHouse(fetchImpl, input.companyNumber, input.apiKey);
  if (!register) throw new Error("Companies House has no company with that number. No verification was recorded.");
  const verification: CompanyVerification = {
    ...register,
    checkedAt: (input.now ?? new Date()).toISOString(),
    domainConfirmed: true,
    confirmedDomain: domain,
    domainEvidence: input.domainEvidence.trim().slice(0, 500),
  };
  const base = prospect.salesIntelligence && typeof prospect.salesIntelligence === "object" && !Array.isArray(prospect.salesIntelligence)
    ? (prospect.salesIntelligence as Record<string, unknown>)
    : {};
  await db.prospect.update({ where: { id: input.prospectId }, data: { salesIntelligence: { ...base, companyVerification: verification } } });
  return verification;
}
