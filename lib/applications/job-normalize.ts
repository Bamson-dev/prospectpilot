import { canonicalApplicationUrl, normalizeWorkMode } from "@/lib/applications/normalize";
import { plainText, technologiesInText } from "@/lib/applications/requirements";

export type RawDiscoveredVacancy = {
  source: string;
  sourceUrl: string;
  applicationUrl: string;
  externalId?: string | null;
  companyName: string;
  title: string;
  location?: string | null;
  employmentType?: string | null;
  workplaceType?: string | null;
  description: string;
  originalDescription?: string | null;
  postedAt?: string | null;
};

export type NormalizedVacancy = {
  source: string;
  sourceUrl: string;
  applicationUrl: string;
  originalSourceUrl: string;
  originalApplicationUrl: string;
  externalId: string | null;
  companyName: string;
  title: string;
  location: string | null;
  remoteType: "remote" | "hybrid" | "on-site" | null;
  employmentType: string | null;
  description: string;
  originalDescription: string;
  technologies: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  postedAt: string | null;
};

export function normalizeVacancy(input: RawDiscoveredVacancy): NormalizedVacancy | null {
  const companyName = collapse(input.companyName);
  const title = collapse(input.title);
  const originalDescription = input.originalDescription ?? input.description;
  const description = plainText(input.description).trim();
  if (!companyName || !title || description.length < 40 || !input.sourceUrl || !input.applicationUrl) return null;
  const location = collapse(input.location ?? "") || null;
  const workplace = normalizeWorkMode(input.workplaceType || location);
  const salary = explicitSalary(description);
  return {
    source: collapse(input.source).toLowerCase(),
    sourceUrl: canonicalApplicationUrl(input.sourceUrl),
    applicationUrl: canonicalApplicationUrl(input.applicationUrl),
    originalSourceUrl: input.sourceUrl.trim(),
    originalApplicationUrl: input.applicationUrl.trim(),
    externalId: collapse(input.externalId ?? "") || null,
    companyName,
    title,
    location,
    remoteType: workplace.remoteType,
    employmentType: explicitEmployment(input.employmentType),
    description,
    originalDescription,
    technologies: technologiesInText(description),
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary?.currency ?? null,
    postedAt: explicitDate(input.postedAt),
  };
}

export function matchesQuery(vacancy: { title: string; description: string }, query: string) {
  const tokens = query.toLowerCase().split(/[^a-z0-9+#]+/).filter((token) => token.length > 3);
  if (tokens.length === 0) return true;
  const haystack = `${vacancy.title} ${vacancy.description}`.toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

function explicitEmployment(value: string | null | undefined) {
  const text = collapse(value ?? "");
  if (!text) return null;
  if (/^(full[- ]time|part[- ]time|contract|permanent|temporary|intern(ship)?)$/i.test(text)) return text;
  return text.length <= 40 ? text : null;
}

function explicitSalary(text: string) {
  if (!/\b(salary|compensation|pay range|base pay)\b/i.test(text)) return null;
  const range = text.match(/(USD|GBP|EUR|\$|£|€)\s?(\d{2,3}(?:,\d{3})+)(?:\s*[-–to]+\s*(?:USD|GBP|EUR|\$|£|€)?\s?(\d{2,3}(?:,\d{3})+))?/i);
  if (!range) return null;
  const currency = currencyCode(range[1]);
  const min = Number(range[2].replace(/,/g, ""));
  const max = range[3] ? Number(range[3].replace(/,/g, "")) : null;
  if (!Number.isFinite(min)) return null;
  return { currency, min, max: max != null && Number.isFinite(max) ? max : null };
}

function currencyCode(token: string) {
  if (token === "£" || token.toUpperCase() === "GBP") return "GBP";
  if (token === "€" || token.toUpperCase() === "EUR") return "EUR";
  return "USD";
}

function explicitDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function collapse(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
