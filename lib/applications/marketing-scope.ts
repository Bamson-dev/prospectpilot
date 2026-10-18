// Marketing-only scope. ProspectPilot searches for, qualifies, prepares and submits applications for
// roles whose primary function is marketing, and nothing else. Every layer calls classifyMarketingRole.
// An unclear role is OUT_OF_SCOPE.

export const MARKETING_SCOPE_VERSION = 1;

export type MarketingVerdict = {
  version: number;
  inScope: boolean;
  label: "IN_SCOPE" | "OUT_OF_SCOPE";
  // The allowlist family or title path that matched. Null when out of scope.
  role: string | null;
  // One sentence that explains the decision.
  reason: string;
};

type VacancyText = { title: string; description?: string | null };

// Words that make a title an engineering or IT role whatever else it says.
const ENGINEERING_TITLE = /\b(engineer|engineers|engineering|programmer|devops|sre|site reliability|sysadmin|system administrator|systems administrator|network administrator|cloud architect|cyber ?security|information security|infosec|data engineer|machine learning|qa|tester|information technology|tech lead|technical lead|cto)\b/i;
// Words that make a title an engineering role only when the title does not also say marketing
// ("Developer Marketing Manager" is a marketing role, "Senior Software Developer" is not).
const SOFT_TECH_TITLE = /\b(software|developer|developers|full[- ]stack|backend|frontend|web developer|mobile developer)\b/i;
const CASE_SENSITIVE_IT = /\bIT\b/;
const NON_MARKETING_FUNCTION = [
  { name: "product management", test: /\b(product manager|product owner|product lead|technical product|head of product|vp of product|director of product|chief product)\b/i },
  { name: "project or programme management", test: /\b(project manager|programme manager|program manager|scrum master|delivery manager|project lead|pmo)\b/i },
  { name: "sales", test: /\b(sales|account executive|account manager|business development|bdr|sdr|revenue manager|partnerships? manager|channel manager)\b/i },
  { name: "customer success or support", test: /\b(customer success|customer support|customer service|customer care|support specialist|support engineer|call cent(er|re)|client success|client services|onboarding manager)\b/i },
  { name: "operations or logistics", test: /\b(operations manager|operations director|head of operations|general manager|supply chain|procurement|logistics|warehouse|fleet|facilities|plant manager|operations lead)\b/i },
  { name: "finance", test: /\b(finance|financial|accountant|accounting|controller|treasury|auditor|audit manager|payroll|tax manager|bookkeeper|fp&a)\b/i },
  { name: "legal or compliance", test: /\b(legal|counsel|attorney|paralegal|compliance|solicitor|lawyer)\b/i },
  { name: "human resources or recruiting", test: /\b(human resources|hr manager|hr business|hr director|people partner|people operations|recruiter|recruitment|talent acquisition|talent partner)\b/i },
  { name: "administration", test: /\b(administrator|administrative|office manager|executive assistant|personal assistant|receptionist|secretary)\b/i },
  { name: "consulting or general strategy", test: /\b(management consultant|consultant|business analyst|business strategist|strategy manager|strategy director|corporate strategy|chief of staff|chief executive|ceo|coo|cfo)\b/i },
  { name: "design", test: /\b(ux designer|ui designer|product designer|graphic designer|interior designer)\b/i },
];

// The word "marketing" is the function. These tokens also name a marketing function by themselves.
const MARKETING_TOKEN = /\b(marketing|marketer|seo|sem|ppc|paid media|paid social|paid search|demand gen(eration)?|lifecycle|crm|affiliate|cmo|growth marketing|brand|content strategist|social media|media buyer)\b/i;
const MARKETING_WORD = /\bmarketing\b|\bmarketer\b/i;
const JUNIOR_TITLE = /\b(intern|internship|trainee|apprentice|assistant|coordinator|graduate|junior|entry[- ]level|volunteer)\b/i;
const LEVEL_NOUN = /\b(manager|lead|head|director|chief|vp|vice president|cmo|strategist|principal|owner|executive|officer|specialist|expert)\b/i;
const LEADERSHIP_NOUN = /\b(manager|lead|head|director|chief|vp|vice president|cmo|strategist|principal)\b/i;

// Titles that are marketing roles on the title alone, once the description shows at least one marketing signal.
const TITLE_FAMILIES: Array<{ role: string; test: RegExp }> = [
  { role: "Growth Marketing", test: /\bgrowth marketing\b|\bhead of growth marketing\b|\bgrowth marketer\b/i },
  { role: "Performance Marketing", test: /\bperformance marketing\b|\bperformance marketer\b/i },
  { role: "Digital Marketing", test: /\bdigital marketing\b|\bdigital growth\b/i },
  { role: "Demand Generation", test: /\bdemand gen(eration)?\b/i },
  { role: "Product Marketing", test: /\bproduct marketing\b/i },
  { role: "Marketing Operations", test: /\bmarketing operations\b|\bmarketing ops\b/i },
  { role: "Paid Media", test: /\bpaid (media|social|search)\b|\bmedia buyer\b|\bppc\b/i },
  { role: "Acquisition Marketing", test: /\bacquisition marketing\b|\buser acquisition\b|\bcustomer acquisition\b/i },
  { role: "Lifecycle and CRM Marketing", test: /\blifecycle marketing\b|\bcrm marketing\b|\bretention marketing\b/i },
  { role: "Affiliate Marketing", test: /\baffiliate (marketing|manager|program|programme)\b/i },
  { role: "Brand Marketing", test: /\bbrand marketing\b/i },
  { role: "Content Marketing", test: /\bcontent marketing\b/i },
  { role: "SEO", test: /\bseo\b/i },
  { role: "Marketing Campaigns", test: /\bmarketing campaign\b|\b(digital|email|paid|ad) campaign manager\b/i },
  { role: "Marketing Analytics", test: /\bmarketing analytics\b/i },
  { role: "Integrated Marketing", test: /\bintegrated marketing\b/i },
  { role: "Regional Marketing", test: /\bregional marketing\b/i },
  { role: "Field Marketing", test: /\bfield marketing\b/i },
  { role: "B2B or B2C Marketing", test: /\bb2[bc] marketing\b/i },
  { role: "Marketing Leadership", test: /\b(marketing (director|lead|manager)|head of marketing|vp (of )?marketing|vice president (of )?marketing|chief marketing officer|\bcmo\b|director of marketing|marketing head)\b/i },
];

// Titles that name a growth or go-to-market function without the word marketing. The description decides.
const AMBIGUOUS_TITLE = /\b(growth|go[- ]to[- ]market|gtm|brand (manager|lead|head)|content (manager|lead|head)|(customer|user|subscriber) acquisition|acquisition (manager|lead|head)|digital strategist|social media (manager|lead|head)|(lifecycle|crm|retention) (manager|lead|head))\b/i;

const MARKETING_SIGNALS: Array<[string, RegExp]> = [
  ["campaigns", /\bcampaigns?\b/i],
  ["paid advertising", /\b(paid (media|social|search|advertising|acquisition)|ppc|google ads|meta ads|facebook ads|linkedin ads|tiktok ads|ad spend|media buying)\b/i],
  ["seo", /\bseo\b|search engine optimi[sz]ation/i],
  ["demand generation", /\bdemand gen(eration)?\b|\blead gen(eration)?\b/i],
  ["customer acquisition", /\b(customer|user) acquisition\b|\bacquisition (channels?|marketing|strategy)\b|\bcac\b|\broas\b/i],
  ["brand and positioning", /\b(brand (strategy|awareness|identity|guidelines)|positioning|messaging)\b/i],
  ["go-to-market", /\bgo[- ]to[- ]market\b|\bgtm\b/i],
  ["lifecycle and crm", /\b(lifecycle|crm|email marketing|retention marketing|newsletter)\b/i],
  ["content marketing", /\b(content (marketing|strategy|calendar)|copywriting|social media)\b/i],
  ["affiliate", /\baffiliate\b/i],
  ["marketing automation", /\b(marketing automation|hubspot|marketo|pardot|klaviyo|braze|mailchimp|martech)\b/i],
  ["funnel and conversion", /\b(funnel|conversion rate|cro\b|landing pages?|attribution)\b/i],
  ["marketing strategy", /\bmarketing (strategy|plan|budget|team|channels?|mix|analytics|performance|campaigns?|programs?|programmes?)\b/i],
  ["product marketing", /\b(product marketing|product launch(es)?|launch plan|competitive intelligence|sales enablement collateral)\b/i],
  ["events and field", /\b(field marketing|event marketing|trade shows?|webinars?)\b/i],
];

const SALES_SIGNALS: RegExp[] = [
  /\bquota\b/i,
  /\bclos(e|ing) (deals?|business|sales)\b/i,
  /\b(cold call(ing)?|outbound sales|prospecting calls?)\b/i,
  /\bbook of business\b/i,
  /\b(renewals?|upsell(ing)?|cross[- ]sell(ing)?)\b/i,
  /\bnegotiat(e|ing) contracts?\b/i,
  /\baccount (executive|manager|management)\b/i,
  /\bsales (target|pipeline|cycle|team|rep|representatives?)\b/i,
  /\bcommission\b/i,
];

const ENGINEERING_SIGNALS: RegExp[] = [
  /\bwrite (clean )?code\b/i,
  /\bcode ?base\b/i,
  /\bsoftware (development|engineering)\b/i,
  /\bcode reviews?\b/i,
  /\b(backend|frontend|full[- ]stack)\b/i,
  /\b(kubernetes|docker|ci\/cd|terraform|microservices?)\b/i,
  /\bunit tests?\b/i,
  /\bapi design\b/i,
  /\bon[- ]call rotation\b/i,
];

const OTHER_FUNCTION_SIGNALS: RegExp[] = [
  /\baccounting\b/i,
  /\bpayroll\b/i,
  /\btax (filings?|returns?)\b/i,
  /\b(financial audit|annual audit|internal audit)\b/i,
  /\b(bookkeeping|accounts (payable|receivable)|financial statements)\b/i,
  /\b(recruit(ing|ment)|talent acquisition|employee relations)\b/i,
  /\b(procurement|supply chain|warehouse|fleet)\b/i,
  /\b(legal counsel|litigation|contract law)\b/i,
];

function count(patterns: RegExp[], text: string) {
  return patterns.filter((pattern) => pattern.test(text)).length;
}

function marketingSignalNames(text: string) {
  return MARKETING_SIGNALS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function out(reason: string): MarketingVerdict {
  return { version: MARKETING_SCOPE_VERSION, inScope: false, label: "OUT_OF_SCOPE", role: null, reason };
}

function inScope(role: string, reason: string): MarketingVerdict {
  return { version: MARKETING_SCOPE_VERSION, inScope: true, label: "IN_SCOPE", role, reason };
}

// Strict test. Title first, then the description. Anything unclear is OUT_OF_SCOPE.
export function classifyMarketingRole(input: VacancyText): MarketingVerdict {
  const title = (input.title ?? "").replace(/\s+/g, " ").trim();
  const description = (input.description ?? "").replace(/\s+/g, " ").trim();
  if (!title) return out("The vacancy has no title.");

  if (ENGINEERING_TITLE.test(title) || CASE_SENSITIVE_IT.test(title)) return out("The title names an engineering or IT role.");
  if (SOFT_TECH_TITLE.test(title) && !MARKETING_WORD.test(title)) return out("The title names a software or developer role.");
  if (JUNIOR_TITLE.test(title)) return out("The title names a junior, intern or coordinator level role.");

  const hasMarketingWord = MARKETING_WORD.test(title);
  const hasMarketingToken = MARKETING_TOKEN.test(title);
  const salesTitle = /\b(sales|account executive|account manager|business development|bdr|sdr|revenue)\b/i.test(title);

  if (!hasMarketingToken) {
    for (const group of NON_MARKETING_FUNCTION) {
      if (!group.test.test(title)) continue;
      // A growth or go-to-market title with a sales word goes to the description test below.
      if (group.name === "sales" && AMBIGUOUS_TITLE.test(title)) break;
      return out(`The title names a ${group.name} role, not marketing.`);
    }
  } else if (hasMarketingWord) {
    // "Marketing Product Manager" or "Marketing Finance Manager" is not a marketing role.
    const cleaned = title.replace(/marketing operations?|marketing ops|product marketing/gi, "");
    for (const group of NON_MARKETING_FUNCTION) {
      if (["product management", "finance", "legal or compliance", "human resources or recruiting", "administration", "operations or logistics"].includes(group.name) && group.test.test(cleaned)) {
        return out(`The title names a ${group.name} role, not marketing.`);
      }
    }
  }

  const signals = marketingSignalNames(`${title} ${description}`);
  const descriptionSignals = marketingSignalNames(description);
  const salesCount = count(SALES_SIGNALS, description);
  const engineeringCount = count(ENGINEERING_SIGNALS, description);
  const otherCount = count(OTHER_FUNCTION_SIGNALS, description);
  const family = TITLE_FAMILIES.find((item) => item.test.test(title));

  // Path A: the title is a marketing role. The description must not contradict it.
  if (family || (hasMarketingWord && LEVEL_NOUN.test(title) && LEADERSHIP_NOUN.test(title))) {
    if (!LEADERSHIP_NOUN.test(title)) return out("The title is below manager, lead or director level.");
    if (salesTitle && !(descriptionSignals.length >= 4 && salesCount <= descriptionSignals.length / 2)) {
      return out("The title mixes sales and marketing and the description is not predominantly marketing.");
    }
    // A clear marketing title with a thin description is accepted on the title. A long description with no
    // marketing responsibilities, or one that points at another function, is not.
    if (descriptionSignals.length === 0 && (description.length >= 200 || otherCount + salesCount + engineeringCount > 0)) {
      return out("The title says marketing but the description shows no marketing responsibilities.");
    }
    if (otherCount >= 2 && otherCount > descriptionSignals.length) {
      return out("The description is mostly finance, HR, legal or operations work despite the marketing title.");
    }
    if (engineeringCount >= 2 && engineeringCount > descriptionSignals.length) {
      return out("The description is mostly engineering work despite the marketing title.");
    }
    if (salesCount >= 3 && salesCount > descriptionSignals.length) {
      return out("The description is mostly sales work despite the marketing title.");
    }
    return inScope(family?.role ?? "Marketing Management", `Marketing title with ${descriptionSignals.length} marketing responsibility signal(s) in the description.`);
  }

  // Path B: a growth, GTM or brand title without the word marketing. The description must prove the function.
  if (AMBIGUOUS_TITLE.test(title) && LEVEL_NOUN.test(title) && !hasMarketingWord) {
    if (signals.length >= 4 && descriptionSignals.length >= 4 && salesCount <= 1 && engineeringCount === 0 && salesCount * 3 <= descriptionSignals.length) {
      return inScope("Growth or Go-To-Market (marketing-led)", `Growth or go-to-market title with ${descriptionSignals.length} marketing responsibility signals and no dominant sales or engineering work.`);
    }
    return out("The title is a growth or go-to-market title and the description does not show a predominantly marketing function.");
  }

  return out("The title is not a marketing role from the approved list.");
}

// The query text that discovery sends to the sources must itself be a marketing title.
export function isMarketingQuery(query: string): boolean {
  const q = query.replace(/\s+/g, " ").trim();
  if (q.length < 3) return false;
  if (ENGINEERING_TITLE.test(q)) return false;
  if (!MARKETING_TOKEN.test(q) && !/\b(growth|go[- ]to[- ]market|gtm)\b/i.test(q)) return false;
  if (!MARKETING_WORD.test(q) && !MARKETING_TOKEN.test(q)) {
    // "growth strategist" or "gtm manager" stay allowed; the vacancy still has to pass the description test.
    return /\b(growth|go[- ]to[- ]market|gtm)\b/i.test(q) && LEVEL_NOUN.test(q);
  }
  return true;
}

export const MARKETING_QUERIES: readonly string[] = [
  "growth marketing manager",
  "growth marketing lead",
  "head of growth marketing",
  "performance marketing manager",
  "digital marketing manager",
  "growth strategist",
  "go-to-market manager",
  "gtm strategist",
  "demand generation manager",
  "product marketing manager",
  "marketing operations manager",
  "marketing director",
  "marketing lead",
  "head of marketing",
  "chief marketing officer",
  "paid media manager",
  "acquisition marketing manager",
  "lifecycle marketing manager",
  "crm marketing manager",
  "affiliate marketing manager",
  "brand marketing manager",
  "content marketing manager",
  "seo manager",
  "seo lead",
  "digital growth lead",
  "marketing campaign manager",
  "marketing analytics manager",
  "integrated marketing manager",
  "regional marketing manager",
  "field marketing manager",
  "b2b marketing manager",
  "b2c marketing manager",
];

// Discovery queries: the candidate's saved roles that are marketing titles, plus nothing else.
// With no usable saved role, the approved list is the fallback.
export function marketingSearchQueries(savedRoles: readonly string[], max = 12): string[] {
  const seen = new Set<string>();
  for (const role of savedRoles) {
    const value = role.toLowerCase().replace(/\s+/g, " ").trim();
    if (value.length >= 3 && value.length <= 80 && isMarketingQuery(value)) seen.add(value);
    if (seen.size >= max) break;
  }
  if (seen.size === 0) for (const query of MARKETING_QUERIES.slice(0, max)) seen.add(query);
  return [...seen];
}

export function marketingBlockedReason(verdict: MarketingVerdict) {
  return `Excluded: not a marketing role. ${verdict.reason}`.slice(0, 480);
}

export type StoredMarketingVerdict = Pick<MarketingVerdict, "version" | "inScope" | "label" | "role" | "reason"> & { checkedAt: string };

export function withTimestamp(verdict: MarketingVerdict, now = new Date()): StoredMarketingVerdict {
  return { ...verdict, checkedAt: now.toISOString() };
}
