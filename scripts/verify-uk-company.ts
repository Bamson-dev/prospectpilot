// Records Companies House evidence for one UK prospect. It never sends email.
//
//   COMPANIES_HOUSE_API_KEY=... npx tsx scripts/verify-uk-company.ts --prospect <id> --number <8 chars> \
//     --domain example.co.uk --evidence "website footer shows Example Ltd, company 01234567"
//
// The sender refuses a UK recipient unless this evidence exists, the company is active and of a
// qualifying type, the check is under 90 days old, and the recipient's email domain matches --domain.
import { prisma } from "@/lib/db";
import { recordCompanyVerification } from "@/lib/compliance/record-verification";
import { ukCompanyEligibility } from "@/lib/compliance/uk-b2b";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : (process.argv[index + 1] ?? "");
}

async function main() {
  const result = await recordCompanyVerification(prisma as never, fetch as never, {
    prospectId: arg("--prospect"),
    companyNumber: arg("--number"),
    confirmedDomain: arg("--domain"),
    domainEvidence: arg("--evidence"),
    apiKey: process.env.COMPANIES_HOUSE_API_KEY,
  });
  const check = ukCompanyEligibility(result, `check@${result.confirmedDomain}`);
  console.log(`${result.companyName} (${result.companyNumber}) ${result.companyStatus} ${result.companyType}: ${check.eligible ? "eligible" : check.reason}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
