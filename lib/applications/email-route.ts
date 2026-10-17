// Finds the employer's application email address in a vacancy posting.
// An address counts only when the sentence that holds it tells candidates to apply there.
// Nothing here guesses or scrapes addresses from other pages.

export type EmailRoute =
  | { found: true; email: string; ownership: "EMPLOYER_DOMAIN" | "POSTING_DESIGNATED"; excerpt: string }
  | { found: false; reason: string };

const EMAIL = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const NOT_A_MAILBOX_SUFFIX = /\.(png|jpe?g|gif|svg|webp|js|css|ico|pdf|html?)$/i;

// Mailboxes that never receive applications. Matched anywhere in the local part so that
// "accessibility", "accommodations", "verification-team" and "fraud.report" are all refused.
const BLOCKED_LOCAL_PART = /(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|abuse|privacy|dpo|dataprotection|datarequest|gdpr|legal|security|unsubscribe|support|helpdesk|press|billing|sales|marketing|webmaster|spam|compliance|notification|accommodat|accessib|adjustment|disabilit|verif|fraud|scam|phish|complain|whistle|safeguard|ethics)/i;
const BLOCKED_LOCAL_EXACT = new Set(["admin", "root", "help", "media", "info", "contact", "hello", "enquiries", "enquiry", "inquiries", "inquiry", "office", "team"]);
const BLOCKED_DOMAIN = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|linkedin\.com|indeed\.com|glassdoor\.com|monster\.com|ziprecruiter\.com|example\.(com|org|net)|sentry\.io|w3\.org|schema\.org|wixpress\.com|facebook\.com|twitter\.com|x\.com)$/i;
const ATS_HOST = /(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|linkedin\.com|indeed\.com)$/i;

// A sentence about any of these is not about applying, even when it also says "email" or "apply".
const BLOCKED_CONTEXT = /\b(accommodations?|accommodate|accessibility|accessible|reasonable adjustments?|disabilit(?:y|ies)|verif(?:y|ication|ied)|fraud(?:ulent)?|scams?|phishing|suspicious|privacy|data protection|data subject|gdpr|complaints?|whistle-?blow\w*|unsubscribe|press enquir\w*|media enquir\w*|customer support|technical support|questions?|queries|enquir\w*|inquir\w*|report (?:a|any|this))\b/i;

// The sentence itself names the application act.
const APPLY_SENTENCE = /\b(apply|applying|applications?)\b/i;
// A send verb, then a candidate document, then the address.
const SEND_DOCUMENT_BEFORE = /\b(send|submit|forward|e-?mail|mail|attach)\b.{0,100}\b(cv|resume|résumé|curriculum vitae|cover letter)\b/i;
const DOCUMENT_THEN_TO = /\b(cv|resume|résumé|curriculum vitae|cover letter)\b[^@]{0,60}\b(to|at)\s*[:\-]?\s*$/i;

function normalizeDomain(value: string | null | undefined) {
  if (!value) return null;
  const text = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return text.includes(".") ? text : null;
}

function companyTokens(name: string) {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !["limited", "company", "group", "solutions", "services", "global", "international"].includes(token));
}

export function isBlockedApplicationMailbox(email: string) {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain) return true;
  if (BLOCKED_LOCAL_EXACT.has(local)) return true;
  if (BLOCKED_LOCAL_PART.test(local)) return true;
  return BLOCKED_DOMAIN.test(domain) || NOT_A_MAILBOX_SUFFIX.test(domain);
}

function sentencesOf(description: string) {
  const sentences: string[] = [];
  for (const line of description.split(/\r?\n+/)) {
    const clean = line.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    for (const part of clean.split(/(?<=[.!?])\s+(?=[A-Z0-9])/)) {
      const sentence = part.trim();
      if (sentence) sentences.push(sentence);
    }
  }
  return sentences;
}

export function findApplicationEmail(input: {
  description: string;
  companyName: string;
  companyDomain?: string | null;
  applicationUrl?: string | null;
  sourceUrl?: string | null;
}): EmailRoute {
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
  const sentences = sentencesOf(input.description);
  for (const sentence of sentences) {
    for (const match of sentence.matchAll(EMAIL)) {
      const email = match[0].toLowerCase().replace(/[.,;:]+$/, "");
      const [local, domain] = email.split("@");
      if (!local || !domain) continue;
      if (isBlockedApplicationMailbox(email)) continue;

      // The sentence that holds the address decides. A neighbouring sentence cannot designate or clear it.
      if (BLOCKED_CONTEXT.test(sentence)) continue;

      const index = match.index ?? 0;
      const before = sentence.slice(0, index);
      const designated = APPLY_SENTENCE.test(sentence) || SEND_DOCUMENT_BEFORE.test(before) || DOCUMENT_THEN_TO.test(before);
      if (!designated) continue;

      const domainMatchesEmployer = [...employerDomains].some((employer) => domain === employer || domain.endsWith(`.${employer}`) || employer.endsWith(`.${domain}`))
        || tokens.some((token) => domain.split(".").slice(0, -1).join(".").includes(token));
      if (!accepted.has(email)) {
        accepted.set(email, { ownership: domainMatchesEmployer ? "EMPLOYER_DOMAIN" : "POSTING_DESIGNATED", excerpt: sentence.slice(0, 220) });
      }
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
