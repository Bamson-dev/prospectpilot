export type FieldTaxonomy =
  | "FIRST_NAME"
  | "LAST_NAME"
  | "FULL_NAME"
  | "PREFERRED_NAME"
  | "PRONOUNS"
  | "EMAIL"
  | "PHONE"
  | "LOCATION"
  | "ADDRESS"
  | "CITY"
  | "STATE"
  | "COUNTRY"
  | "POSTAL_CODE"
  | "LINKEDIN"
  | "GITHUB"
  | "PORTFOLIO"
  | "WEBSITE"
  | "CURRENT_TITLE"
  | "CURRENT_COMPANY"
  | "RESUME"
  | "COVER_LETTER"
  | "REFERRED_BY"
  | "SOURCE"
  | "WORK_AUTHORIZATION"
  | "SPONSORSHIP"
  | "AVAILABILITY"
  | "NOTICE_PERIOD"
  | "EMPLOYMENT_TYPE"
  | "REMOTE_PREFERENCE"
  | "RELOCATION"
  | "SALARY"
  | "HOURLY_RATE"
  | "EXPECTED_COMPENSATION"
  | "DEGREE"
  | "INSTITUTION"
  | "FIELD_OF_STUDY"
  | "GRADUATION_DATE"
  | "YEARS_OF_EXPERIENCE"
  | "YEARS_OF_TECHNOLOGY_EXPERIENCE"
  | "MANAGEMENT_EXPERIENCE"
  | "VETERAN_STATUS"
  | "DISABILITY_STATUS"
  | "GENDER"
  | "ETHNICITY"
  | "SKILL_RATING"
  | "TECHNOLOGY_USE"
  | "CUSTOM_QUESTION"
  | "UNKNOWN";

export const CONFIDENCE_THRESHOLD = 0.85;

const SENSITIVE = new Set<FieldTaxonomy>(["VETERAN_STATUS", "DISABILITY_STATUS", "GENDER", "ETHNICITY", "PRONOUNS"]);

const RULES: Array<{ taxonomy: FieldTaxonomy; phrases: string[] }> = [
  { taxonomy: "COVER_LETTER", phrases: ["cover letter upload", "cover letter"] },
  { taxonomy: "RESUME", phrases: ["curriculum vitae", "resume", "cv"] },
  { taxonomy: "WORK_AUTHORIZATION", phrases: ["work authorization", "authorized to work", "authorised to work", "legally authorized", "right to work", "eligible to work"] },
  { taxonomy: "SPONSORSHIP", phrases: ["visa sponsorship", "require sponsorship", "sponsorship", "need sponsorship"] },
  { taxonomy: "HOURLY_RATE", phrases: ["hourly rate", "hourly pay"] },
  { taxonomy: "EXPECTED_COMPENSATION", phrases: ["expected compensation", "desired compensation", "compensation expectation"] },
  { taxonomy: "SALARY", phrases: ["salary expectation", "expected salary", "desired salary", "salary"] },
  { taxonomy: "YEARS_OF_TECHNOLOGY_EXPERIENCE", phrases: ["years of experience with", "years of", "how many years"] },
  { taxonomy: "YEARS_OF_EXPERIENCE", phrases: ["years of experience", "years experience"] },
  { taxonomy: "MANAGEMENT_EXPERIENCE", phrases: ["management experience", "people management"] },
  { taxonomy: "SKILL_RATING", phrases: ["rate your", "skill level", "from 1 10", "from 1 to 10", "out of 10"] },
  { taxonomy: "TECHNOLOGY_USE", phrases: ["have you used", "have you worked with", "do you have experience with"] },
  { taxonomy: "LINKEDIN", phrases: ["linkedin profile", "linkedin url", "linkedin"] },
  { taxonomy: "GITHUB", phrases: ["github profile", "github url", "github"] },
  { taxonomy: "PORTFOLIO", phrases: ["portfolio url", "portfolio", "personal website", "personal site"] },
  { taxonomy: "WEBSITE", phrases: ["website url", "website"] },
  { taxonomy: "FIRST_NAME", phrases: ["legal first name", "given name", "first name"] },
  { taxonomy: "LAST_NAME", phrases: ["family name", "last name", "surname"] },
  { taxonomy: "PREFERRED_NAME", phrases: ["preferred name", "nickname"] },
  { taxonomy: "FULL_NAME", phrases: ["full name", "legal name"] },
  { taxonomy: "EMAIL", phrases: ["email address", "e mail", "email"] },
  { taxonomy: "PHONE", phrases: ["mobile number", "mobile phone", "phone number", "telephone", "mobile", "phone"] },
  { taxonomy: "POSTAL_CODE", phrases: ["postal code", "zip code", "postcode"] },
  { taxonomy: "LOCATION", phrases: ["current location", "where are you located", "where are you currently based", "location"] },
  { taxonomy: "ADDRESS", phrases: ["street address", "address"] },
  { taxonomy: "CITY", phrases: ["city"] },
  { taxonomy: "STATE", phrases: ["state", "province"] },
  { taxonomy: "COUNTRY", phrases: ["country"] },
  { taxonomy: "CURRENT_TITLE", phrases: ["current title", "job title"] },
  { taxonomy: "CURRENT_COMPANY", phrases: ["current company", "current employer"] },
  { taxonomy: "REFERRED_BY", phrases: ["referred by", "referral"] },
  { taxonomy: "SOURCE", phrases: ["how did you hear", "source"] },
  { taxonomy: "AVAILABILITY", phrases: ["availability", "start date", "when can you start"] },
  { taxonomy: "NOTICE_PERIOD", phrases: ["notice period"] },
  { taxonomy: "EMPLOYMENT_TYPE", phrases: ["employment type", "full-time or part-time"] },
  { taxonomy: "REMOTE_PREFERENCE", phrases: ["remote preference", "work arrangement"] },
  { taxonomy: "RELOCATION", phrases: ["willing to relocate", "relocation"] },
  { taxonomy: "DEGREE", phrases: ["degree"] },
  { taxonomy: "FIELD_OF_STUDY", phrases: ["field of study", "major"] },
  { taxonomy: "GRADUATION_DATE", phrases: ["graduation date", "graduation year"] },
  { taxonomy: "INSTITUTION", phrases: ["institution", "university", "college"] },
  { taxonomy: "VETERAN_STATUS", phrases: ["veteran status", "veteran"] },
  { taxonomy: "DISABILITY_STATUS", phrases: ["disability status", "disability"] },
  { taxonomy: "GENDER", phrases: ["gender identity", "gender"] },
  { taxonomy: "ETHNICITY", phrases: ["race/ethnicity", "ethnicity", "race"] },
  { taxonomy: "PRONOUNS", phrases: ["pronouns"] },
];

const AUTOCOMPLETE: Record<string, FieldTaxonomy> = {
  "given-name": "FIRST_NAME",
  "family-name": "LAST_NAME",
  name: "FULL_NAME",
  email: "EMAIL",
  tel: "PHONE",
  "street-address": "ADDRESS",
  "address-level2": "CITY",
  "address-level1": "STATE",
  "postal-code": "POSTAL_CODE",
  country: "COUNTRY",
  "country-name": "COUNTRY",
  url: "WEBSITE",
  organization: "CURRENT_COMPANY",
  "organization-title": "CURRENT_TITLE",
};

export type FieldSignals = {
  label?: string | null;
  name?: string | null;
  id?: string | null;
  placeholder?: string | null;
  ariaLabel?: string | null;
  nearby?: string | null;
  type?: string | null;
  autocomplete?: string | null;
  section?: string | null;
  options?: string[];
};

export type FieldJudgment = {
  taxonomy: FieldTaxonomy;
  confidence: number;
  evidence: string[];
  ambiguous: boolean;
};

export function normalizeFieldText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[_./-]+/g, " ")
    .replace(/[^a-z0-9+#\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function judgeField(field: FieldSignals): FieldJudgment {
  const section = normalizeFieldText(field.section);
  const school = /\bschool\b|\buniversity\b|\bcollege\b/.test(normalizeFieldText(`${field.label} ${field.ariaLabel} ${field.name} ${field.id}`));
  if (school && /education/.test(section)) {
    return { taxonomy: "INSTITUTION", confidence: 0.96, evidence: ["section", "label"], ambiguous: false };
  }
  if (school && /employment|experience|work history/.test(section)) {
    return { taxonomy: "CURRENT_COMPANY", confidence: 0.9, evidence: ["section", "label"], ambiguous: false };
  }
  const autocomplete = normalizeFieldText(field.autocomplete);
  if (AUTOCOMPLETE[autocomplete]) {
    const taxonomy = autocomplete === "url" && /linkedin/.test(normalizeFieldText(`${field.label} ${field.name}`)) ? "LINKEDIN" : AUTOCOMPLETE[autocomplete];
    return { taxonomy, confidence: 0.99, evidence: field.label ? ["label", "autocomplete"] : ["autocomplete"], ambiguous: false };
  }
  const hits = scoreRules(field);
  if (hits.length === 0) {
    const text = combined(field);
    if (/\?/.test(field.label ?? field.ariaLabel ?? "") || (field.type ?? "").toLowerCase() === "textarea") {
      return { taxonomy: "CUSTOM_QUESTION", confidence: 0.7, evidence: ["question text"], ambiguous: false };
    }
    if (text) return { taxonomy: "UNKNOWN", confidence: 0.4, evidence: ["no matching synonym"], ambiguous: false };
    return { taxonomy: "UNKNOWN", confidence: 0.2, evidence: ["empty field"], ambiguous: false };
  }
  const best = hits[0];
  const close = hits.filter((hit) => best.score - hit.score < 0.08);
  const phrases = close.map((hit) => ({ hit, phrase: matchedPhrase(combined(field), hit.taxonomy) }));
  const pool = phrases.filter(({ phrase }) => {
    const generic = phrase === "country" || phrase === "city" || phrase === "state";
    return !generic || !phrases.some((other) => other.phrase.length >= phrase.length + 8);
  }).map((item) => item.hit);
  const usable = pool.length ? pool : close;
  const sponsored = usable.find((hit) => hit.taxonomy === "SPONSORSHIP");
  if (sponsored && /sponsor/.test(combined(field))) {
    return { taxonomy: "SPONSORSHIP", confidence: Number(sponsored.score.toFixed(2)), evidence: sponsored.evidence, ambiguous: false };
  }
  const located = usable.find((hit) => hit.taxonomy === "LOCATION");
  if (located && /\blocation\b/.test(combined(field))) {
    return { taxonomy: "LOCATION", confidence: Number(located.score.toFixed(2)), evidence: located.evidence, ambiguous: false };
  }
  const chosen = usable[0] ?? best;
  const ambiguous = usable.length > 1 && chosen.taxonomy !== usable[1]?.taxonomy;
  if (ambiguous) return { taxonomy: "UNKNOWN", confidence: chosen.score, evidence: ["ambiguous synonyms"], ambiguous: true };
  if (chosen.taxonomy === "YEARS_OF_TECHNOLOGY_EXPERIENCE" && !namesTechnology(combined(field))) {
    return { taxonomy: "YEARS_OF_EXPERIENCE", confidence: chosen.score, evidence: chosen.evidence, ambiguous: false };
  }
  if ((chosen.taxonomy === "YEARS_OF_EXPERIENCE" || chosen.taxonomy === "YEARS_OF_TECHNOLOGY_EXPERIENCE") && namesTechnology(combined(field)) && /years/.test(combined(field))) {
    return { taxonomy: "YEARS_OF_TECHNOLOGY_EXPERIENCE", confidence: chosen.score, evidence: [...chosen.evidence, "technology name"], ambiguous: false };
  }
  return { taxonomy: chosen.taxonomy, confidence: Number(chosen.score.toFixed(2)), evidence: chosen.evidence, ambiguous: false };
}

export function isSensitiveTaxonomy(taxonomy: FieldTaxonomy) {
  return SENSITIVE.has(taxonomy);
}

export type AnswerStatus = "ANSWERED" | "REVIEW_REQUIRED" | "UNSUPPORTED";

export function resolveFieldAnswer(input: {
  judgment: FieldJudgment;
  required: boolean;
  options?: string[];
  questionText?: string;
  values: Record<string, string | null | undefined>;
  verifiedTechnologies?: string[];
}) {
  const taxonomy = input.judgment.confidence < CONFIDENCE_THRESHOLD && input.judgment.taxonomy !== "CUSTOM_QUESTION" ? "UNKNOWN" : input.judgment.taxonomy;
  if (taxonomy === "UNKNOWN") {
    return { status: input.required ? "UNSUPPORTED" as const : "REVIEW_REQUIRED" as const, value: null as string | null, source: null as string | null, reason: input.required ? "unknown required field" : input.judgment.ambiguous ? "ambiguous field" : "unclassified field" };
  }
  if (isSensitiveTaxonomy(taxonomy) || taxonomy === "SKILL_RATING") {
    return { status: "REVIEW_REQUIRED" as const, value: null, source: null, reason: taxonomy === "SKILL_RATING" ? "skill rating is not on file" : "sensitive question" };
  }
  if (taxonomy === "TECHNOLOGY_USE") {
    const technology = namedTechnology(input.questionText ?? "");
    const verified = (input.verifiedTechnologies ?? []).some((item) => normalizeFieldText(item) === normalizeFieldText(technology));
    if (!technology || !verified) return { status: "REVIEW_REQUIRED" as const, value: null, source: null, reason: "technology use is not verified" };
    return chooseOption(input.options, "Yes", "verified technology");
  }
  if (taxonomy === "YEARS_OF_TECHNOLOGY_EXPERIENCE") {
    return { status: "REVIEW_REQUIRED" as const, value: null, source: null, reason: "technology duration is not verified" };
  }
  if (taxonomy === "CUSTOM_QUESTION") {
    return { status: "REVIEW_REQUIRED" as const, value: null, source: null, reason: "custom question" };
  }
  const key = valueKey(taxonomy);
  const raw = (input.values[key] ?? "").trim();
  if (!raw) return { status: "REVIEW_REQUIRED" as const, value: null, source: null, reason: "unknown value" };
  return chooseOption(input.options, raw, "candidate");
}

export function fieldMetrics(fields: Array<{ taxonomy: FieldTaxonomy; required: boolean; status: AnswerStatus; confidence: number }>, classificationTimeMs: number) {
  const classified = fields.filter((field) => field.taxonomy !== "UNKNOWN" && field.confidence >= CONFIDENCE_THRESHOLD);
  const required = fields.filter((field) => field.required);
  const requiredClassified = required.filter((field) => field.taxonomy !== "UNKNOWN" && field.confidence >= CONFIDENCE_THRESHOLD);
  const requiredUnresolved = required.filter((field) => field.status !== "ANSWERED");
  return {
    fieldsDetected: fields.length,
    fieldsClassified: classified.length,
    fieldsUnknown: fields.length - classified.length,
    fieldsReviewRequired: fields.filter((field) => field.status === "REVIEW_REQUIRED").length,
    requiredFields: required.length,
    requiredFieldsClassified: requiredClassified.length,
    requiredFieldsUnresolved: requiredUnresolved.length,
    classificationTimeMs,
    classificationRate: fields.length === 0 ? 0 : Number((classified.length / fields.length).toFixed(2)),
    requiredFieldResolutionRate: required.length === 0 ? 1 : Number((required.filter((field) => field.status === "ANSWERED").length / required.length).toFixed(2)),
  };
}

function chooseOption(options: string[] | undefined, value: string, source: string) {
  if (!options?.length) return { status: "ANSWERED" as const, value, source, reason: null as string | null };
  const wanted = normalizeFieldText(value);
  const matches = options.filter((option) => {
    const text = normalizeFieldText(option);
    return text === wanted || text === normalizeFieldText(value.split(" ")[0] ?? "");
  });
  if (matches.length === 1) return { status: "ANSWERED" as const, value: matches[0], source, reason: null };
  return { status: "REVIEW_REQUIRED" as const, value: null, source: null, reason: matches.length > 1 ? "ambiguous option" : "no matching option" };
}

function valueKey(taxonomy: FieldTaxonomy) {
  const map: Partial<Record<FieldTaxonomy, string>> = {
    FIRST_NAME: "firstName",
    LAST_NAME: "lastName",
    FULL_NAME: "fullName",
    EMAIL: "email",
    PHONE: "phone",
    LOCATION: "location",
    CITY: "location",
    COUNTRY: "country",
    LINKEDIN: "linkedin",
    GITHUB: "github",
    PORTFOLIO: "portfolio",
    WEBSITE: "website",
    RESUME: "resume",
    COVER_LETTER: "coverLetter",
    WORK_AUTHORIZATION: "workAuthorization",
    SPONSORSHIP: "sponsorship",
    SALARY: "salary",
    EXPECTED_COMPENSATION: "salary",
    AVAILABILITY: "availability",
    NOTICE_PERIOD: "noticePeriod",
    DEGREE: "degree",
    INSTITUTION: "institution",
    FIELD_OF_STUDY: "fieldOfStudy",
    YEARS_OF_EXPERIENCE: "yearsExperience",
    CURRENT_TITLE: "currentTitle",
    CURRENT_COMPANY: "currentCompany",
  };
  return map[taxonomy] ?? taxonomy;
}

function scoreRules(field: FieldSignals) {
  const signals: Array<{ evidence: string; text: string; bonus: number }> = [
    { evidence: "label", text: normalizeFieldText(field.label), bonus: 0.28 },
    { evidence: "aria-label", text: normalizeFieldText(field.ariaLabel), bonus: 0.26 },
    { evidence: "placeholder", text: normalizeFieldText(field.placeholder), bonus: 0.18 },
    { evidence: "name", text: normalizeFieldText(field.name), bonus: 0.2 },
    { evidence: "id", text: normalizeFieldText(field.id), bonus: 0.18 },
    { evidence: "question text", text: normalizeFieldText(field.nearby), bonus: 0.12 },
    { evidence: "section", text: normalizeFieldText(field.section), bonus: 0.16 },
  ];
  const scored: Array<{ taxonomy: FieldTaxonomy; score: number; evidence: string[] }> = [];
  for (const rule of RULES) {
    let best = 0;
    const evidence: string[] = [];
    for (const signal of signals) {
      const phrase = longestPhrase(signal.text, rule.phrases);
      if (!phrase) continue;
      const score = Math.min(0.99, 0.62 + phrase.length / 80 + signal.bonus);
      if (score > best) best = score;
      evidence.push(signal.evidence);
    }
    if (best > 0) scored.push({ taxonomy: rule.taxonomy, score: best, evidence: [...new Set(evidence)] });
  }
  return scored.sort((left, right) => right.score - left.score);
}

function matchedPhrase(text: string, taxonomy: FieldTaxonomy) {
  const rule = RULES.find((item) => item.taxonomy === taxonomy);
  return longestPhrase(text, rule?.phrases ?? []);
}

function longestPhrase(text: string, phrases: string[]) {
  return phrases.filter((phrase) => phraseIn(text, phrase)).sort((left, right) => right.length - left.length)[0] ?? "";
}

function phraseIn(text: string, phrase: string) {
  if (!text || !phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^| )${escaped}(?: |$)`).test(text);
}

function combined(field: FieldSignals) {
  return normalizeFieldText([field.label, field.ariaLabel, field.placeholder, field.name, field.id, field.nearby, field.section].filter(Boolean).join(" "));
}

const TECHNOLOGIES = ["typescript", "node.js", "nodejs", "react", "next.js", "postgresql", "python", "javascript"];

export function namesTechnology(text: string) {
  const normal = normalizeFieldText(text);
  return TECHNOLOGIES.some((item) => normal.includes(item.replace(".js", " js")) || normal.includes(item));
}

export function namedTechnology(text: string) {
  const normal = normalizeFieldText(text);
  return TECHNOLOGIES.find((item) => normal.includes(item) || normal.includes(item.replace(".", " "))) ?? null;
}

export function coarseClass(taxonomy: FieldTaxonomy) {
  if (["FIRST_NAME", "LAST_NAME", "FULL_NAME", "PREFERRED_NAME", "EMAIL", "PHONE", "LOCATION", "ADDRESS", "CITY", "STATE", "COUNTRY", "POSTAL_CODE"].includes(taxonomy)) return "CONTACT" as const;
  if (["LINKEDIN", "GITHUB", "PORTFOLIO", "WEBSITE", "CURRENT_TITLE", "CURRENT_COMPANY"].includes(taxonomy)) return "PROFILE" as const;
  if (taxonomy === "RESUME") return "RESUME" as const;
  if (taxonomy === "COVER_LETTER") return "COVER_LETTER" as const;
  if (taxonomy === "WORK_AUTHORIZATION") return "WORK_AUTH" as const;
  if (taxonomy === "SPONSORSHIP") return "SPONSORSHIP" as const;
  if (["SALARY", "HOURLY_RATE", "EXPECTED_COMPENSATION"].includes(taxonomy)) return "SALARY" as const;
  if (["DEGREE", "INSTITUTION", "FIELD_OF_STUDY", "GRADUATION_DATE"].includes(taxonomy)) return "EDUCATION" as const;
  if (["YEARS_OF_EXPERIENCE", "YEARS_OF_TECHNOLOGY_EXPERIENCE", "MANAGEMENT_EXPERIENCE", "SKILL_RATING", "TECHNOLOGY_USE"].includes(taxonomy)) return "EXPERIENCE" as const;
  if (isSensitiveTaxonomy(taxonomy)) return "DEMOGRAPHIC" as const;
  if (taxonomy === "CUSTOM_QUESTION") return "CUSTOM_QUESTION" as const;
  return "UNKNOWN" as const;
}
