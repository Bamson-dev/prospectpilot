// Finds the employer's application email address in a vacancy posting.
// An address counts only when the posting itself designates it for applications.
// Nothing here guesses or scrapes addresses from other pages.

export type EmailRoute =
  | { found: true; email: string; ownership: "EMPLOYER_DOMAIN" | "POSTING_DESIGNATED"; excerpt: string }
  | { found: false; reason: string };

const EMAIL = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const NOT_A_MAILBOX_SUFFIX = /\.(png|jpe?g|gif|svg|webp|js|css|ico|pdf|html?)$/i;
const BLOCKED_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|noreply|mailer-daemon|postmaster|abuse|privacy|dpo|legal|security|unsubscribe|support|help|press|media|billing|sales|marketing|webmaster|admin|root|spam|compliance|gdpr|notifications?)$/i;
const BLOCKED_DOMAIN = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|linkedin\.com|indeed\.com|glassdoor\.com|monster\.com|ziprecruiter\.com|example\.(com|org|net)|sentry\.io|w3\.org|schema\.org|wixpress\.com|facebook\.com|twitter\.com|x\.com)$/i;
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|aol|icloud|proton|protonmail|gmx|zoho|mail)\./i;
const ATS_HOST = /(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|linkedin\.com|indeed\.com)$/i;
const INSTRUCTION = /\b(apply|applications?|applicants?|send|submit|forward|e-?mail|mail|cv|resume|résumé|curriculum vitae|cover letter|recruit(?:ment|er|ing)?|hiring|careers?|interested candidates?)\b/i;
const STRONG_INSTRUCTION = /\b(send|submit|forward|e-?mail|mail|apply)\b[^.\n]{0,120}$/i;

function normalizeDomain(value: string | null | undefined) {
  if (!value) return null;
  const text = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return text.includes(".") ? text : null;
}

function companyTokens(name: string) {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !["limited", "company", "group", "solutions", "services", "global", "international"].includes(token));
}

export function findApplicationEmail(input: {
  description: string;
  companyName: string;
  companyDomain?: string | null;
  applicationUrl?: string | null;
  sourceUrl?: string | null;
}): EmailRoute {
  const text = input.description.replace(/\s+/g, " ");
  const employerDomains = new Set<string>();
  const known = normalizeDomain(input.companyDomain);
  if (known) employerDomains.add(known);
  for (const url of [input.applicationUrl, input.sourceUrl]) {
    try {
      const host = new URL(url ?? "").hostname.toLowerCase().replace(/^www\./, "");
      if (host && !ATS_HOST.test(host)) employerDomains.add(host);
    } catch {
      // Not a URL.
    }
  }
  const tokens = companyTokens(input.companyName);

  const accepted = new Map<string, { ownership: "EMPLOYER_DOMAIN" | "POSTING_DESIGNATED"; excerpt: string }>();
  for (const match of text.matchAll(EMAIL)) {
    const email = match[0].toLowerCase().replace(/[.,;:]+$/, "");
    const [local, domain] = email.split("@");
    if (!local || !domain || NOT_A_MAILBOX_SUFFIX.test(domain)) continue;
    if (BLOCKED_LOCAL.test(local) || BLOCKED_DOMAIN.test(domain)) continue;
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 160), index);
    const after = text.slice(index + email.length, index + email.length + 100);
    const nearby = `${before} ${after}`;
    if (!INSTRUCTION.test(nearby)) continue;
    const designated = STRONG_INSTRUCTION.test(before) || /\b(apply|applications?)\b/i.test(after);
    const domainMatchesEmployer = [...employerDomains].some((employer) => domain === employer || domain.endsWith(`.${employer}`) || employer.endsWith(`.${domain}`))
      || tokens.some((token) => domain.split(".").slice(0, -1).join(".").includes(token));
    if (FREE_MAIL.test(domain) && !designated) continue;
    if (!domainMatchesEmployer && !designated) continue;
    if (!accepted.has(email)) {
      accepted.set(email, { ownership: domainMatchesEmployer ? "EMPLOYER_DOMAIN" : "POSTING_DESIGNATED", excerpt: nearby.trim().slice(0, 220) });
    }
  }
  if (accepted.size === 0) return { found: false, reason: "The posting does not name an application email address." };
  const entries = [...accepted.entries()];
  const employerOwned = entries.filter(([, value]) => value.ownership === "EMPLOYER_DOMAIN");
  const pick = employerOwned.length === 1 ? employerOwned[0] : entries.length === 1 ? entries[0] : null;
  if (!pick) return { found: false, reason: "The posting names more than one possible application address." };
  return { found: true, email: pick[0], ownership: pick[1].ownership, excerpt: pick[1].excerpt };
}

export function applicationSubject(title: string, fullName: string) {
  const subject = `Application for ${title.replace(/\s+/g, " ").trim()} - ${fullName.replace(/\s+/g, " ").trim()}`;
  return subject.length > 150 ? `${subject.slice(0, 147)}...` : subject;
}

export function applicationBody(input: { letter: string; fullName: string; email: string; phone?: string | null }) {
  const footer = [
    "",
    "My CV and cover letter are attached as PDF files.",
    "",
    input.fullName,
    input.email,
    input.phone ? input.phone : "",
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
  const letter = input.letter.replace(/\r\n/g, "\n").trim();
  if (letter.length + footer.length <= 7000) return `${letter}\n${footer}`;
  return `Dear Hiring Team,\n\nPlease find my application attached. My cover letter and CV are included as PDF files.\n${footer}`;
}
