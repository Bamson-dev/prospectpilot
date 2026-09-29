export type BlockerClass = "HARD_BLOCKER" | "REVIEW_REQUIRED" | "OPTIONAL";

export type Blocker = {
  label: string;
  class: BlockerClass;
};

export function classifyBlockers(input: {
  captcha?: boolean;
  cloudflare?: boolean;
  authentication?: boolean;
  unknownRequired?: string[];
  workAuthorizationKnown?: boolean;
  workAuthorizationAsked?: boolean;
  sponsorshipKnown?: boolean;
  sponsorshipAsked?: boolean;
  salaryKnown?: boolean;
  salaryAsked?: boolean;
  linkedinKnown?: boolean;
}) {
  const blockers: Blocker[] = [];
  if (input.captcha) blockers.push({ label: "CAPTCHA", class: "HARD_BLOCKER" });
  if (input.cloudflare) blockers.push({ label: "Cloudflare", class: "HARD_BLOCKER" });
  if (input.authentication) blockers.push({ label: "Authentication", class: "HARD_BLOCKER" });
  for (const field of input.unknownRequired ?? []) {
    blockers.push({ label: field, class: "REVIEW_REQUIRED" });
  }
  if (input.workAuthorizationAsked && !input.workAuthorizationKnown) {
    blockers.push({ label: "Work authorization", class: "REVIEW_REQUIRED" });
  }
  if (input.sponsorshipAsked && !input.sponsorshipKnown) {
    blockers.push({ label: "Sponsorship", class: "REVIEW_REQUIRED" });
  }
  if (input.salaryAsked && !input.salaryKnown) {
    blockers.push({ label: "Salary", class: "REVIEW_REQUIRED" });
  }
  if (!input.salaryAsked && !input.salaryKnown) {
    blockers.push({ label: "Salary", class: "OPTIONAL" });
  }
  if (!input.linkedinKnown) blockers.push({ label: "LinkedIn", class: "OPTIONAL" });
  return blockers;
}
