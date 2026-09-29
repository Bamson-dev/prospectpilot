export type FieldClass =
  | "CONTACT"
  | "PROFILE"
  | "RESUME"
  | "COVER_LETTER"
  | "WORK_AUTH"
  | "SPONSORSHIP"
  | "SALARY"
  | "EDUCATION"
  | "EXPERIENCE"
  | "CUSTOM_QUESTION"
  | "UNKNOWN";

export type RawField = {
  label?: string | null;
  name?: string | null;
  id?: string | null;
  type?: string | null;
  required?: boolean;
  placeholder?: string | null;
  ariaLabel?: string | null;
  options?: string[];
  nearby?: string | null;
};

export type InspectedField = {
  label: string;
  name: string;
  id: string;
  type: string;
  required: boolean;
  placeholder: string;
  ariaLabel: string;
  options: string[];
  question: string;
  classification: FieldClass;
};

export type MappedAnswer = {
  name: string;
  classification: FieldClass;
  status: "ANSWERED" | "REVIEW_REQUIRED" | "UNSUPPORTED";
  value: string | null;
  reason: string | null;
};

const ORDER: Array<{ classification: FieldClass; pattern: RegExp }> = [
  { classification: "RESUME", pattern: /resume|curriculum|\bcv\b/i },
  { classification: "COVER_LETTER", pattern: /cover[\s_-]?letter/i },
  { classification: "SPONSORSHIP", pattern: /sponsor/i },
  { classification: "WORK_AUTH", pattern: /authori[sz]ed|work authorization|right to work|visa|eligible to work/i },
  { classification: "SALARY", pattern: /salary|compensation|pay expectation|expected pay/i },
  { classification: "EDUCATION", pattern: /education|degree|university|school/i },
  { classification: "EXPERIENCE", pattern: /years of|experience/i },
  { classification: "PROFILE", pattern: /linkedin|github|portfolio|personal site|website/i },
  { classification: "CONTACT", pattern: /e-?mail|phone|mobile|first[\s_-]?name|last[\s_-]?name|full[\s_-]?name|^name$|location|city/i },
];

export function classifyField(field: RawField): FieldClass {
  const text = fieldText(field);
  if ((field.type ?? "").toLowerCase() === "file" && /resume|curriculum|\bcv\b/i.test(text)) return "RESUME";
  if ((field.type ?? "").toLowerCase() === "file" && /cover/i.test(text)) return "COVER_LETTER";
  const match = ORDER.find((item) => item.pattern.test(text));
  if (match) return match.classification;
  if (/\?/.test(text) || (field.type ?? "").toLowerCase() === "textarea") return "CUSTOM_QUESTION";
  return "UNKNOWN";
}

export function inspectFields(fields: RawField[]): InspectedField[] {
  return fields.map((field) => {
    const question = clip(field.label || field.ariaLabel || field.nearby || field.placeholder || "");
    return {
      label: clip(field.label),
      name: clip(field.name),
      id: clip(field.id),
      type: clip(field.type).toLowerCase(),
      required: Boolean(field.required) || /required/i.test(`${field.label ?? ""} ${field.ariaLabel ?? ""}`),
      placeholder: clip(field.placeholder),
      ariaLabel: clip(field.ariaLabel),
      options: (field.options ?? []).map((option) => clip(option, 80)).filter(Boolean).slice(0, 20),
      question,
      classification: classifyField(field),
    };
  });
}

export function mapCandidateToFields(fields: InspectedField[], values: Record<string, string | null | undefined>) {
  return fields.map((field) => mapOne(field, values));
}

function mapOne(field: InspectedField, values: Record<string, string | null | undefined>): MappedAnswer {
  const key = candidateKey(field);
  if (field.classification === "UNKNOWN") {
    return { name: field.name || field.id || field.question, classification: field.classification, status: field.required ? "UNSUPPORTED" : "REVIEW_REQUIRED", value: null, reason: field.required ? "unknown required field" : "unclassified field" };
  }
  if (!key) {
    return { name: field.name || field.question, classification: field.classification, status: "REVIEW_REQUIRED", value: null, reason: "ambiguous field" };
  }
  const value = (values[key] ?? "").trim();
  if (!value) {
    return { name: field.name || field.question, classification: field.classification, status: "REVIEW_REQUIRED", value: null, reason: "unknown value" };
  }
  return { name: field.name || field.question, classification: field.classification, status: "ANSWERED", value, reason: null };
}

export function candidateKey(field: InspectedField) {
  const text = `${field.label} ${field.name} ${field.id} ${field.ariaLabel} ${field.placeholder} ${field.question}`;
  if (field.classification === "RESUME") return "resume";
  if (field.classification === "COVER_LETTER") return "coverLetter";
  if (field.classification === "WORK_AUTH") return "workAuthorization";
  if (field.classification === "SPONSORSHIP") return "sponsorship";
  if (field.classification === "SALARY") return "salary";
  if (field.classification === "EDUCATION") return "education";
  if (field.classification === "EXPERIENCE") return /years/i.test(text) ? "yearsExperience" : null;
  if (field.classification === "PROFILE") {
    const hits = [
      /linkedin/i.test(text) ? "linkedin" : "",
      /github/i.test(text) ? "github" : "",
      /portfolio|personal site|website/i.test(text) ? "portfolio" : "",
    ].filter(Boolean);
    return hits.length === 1 ? hits[0] : null;
  }
  if (field.classification === "CONTACT") {
    if (/e-?mail/i.test(text)) return "email";
    if (/phone|mobile/i.test(text)) return "phone";
    if (/first/i.test(text)) return "firstName";
    if (/last|surname/i.test(text)) return "lastName";
    if (/full[\s_-]?name|^name\b/i.test(text)) return "fullName";
    if (/location|city/i.test(text)) return "location";
  }
  if (field.classification === "CUSTOM_QUESTION") return null;
  return null;
}

export function fieldsFromHtml(html: string): RawField[] {
  const fields: RawField[] = [];
  const tags = html.match(/<(input|textarea|select)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const id = attr(tag, "id");
    const name = attr(tag, "name");
    const type = attr(tag, "type") || (tag.toLowerCase().startsWith("<textarea") ? "textarea" : tag.toLowerCase().startsWith("<select") ? "select" : "text");
    fields.push({
      id,
      name,
      type,
      required: /\brequired\b/i.test(tag) || attr(tag, "aria-required") === "true",
      placeholder: attr(tag, "placeholder"),
      ariaLabel: attr(tag, "aria-label"),
      label: labelFor(html, id, name),
      options: tag.toLowerCase().startsWith("<select") ? optionsAfter(html, tag) : [],
    });
  }
  return fields;
}

function labelFor(html: string, id: string | null, name: string | null) {
  if (id) {
    const match = html.match(new RegExp(`<label[^>]*for=["']${escapeReg(id)}["'][^>]*>([\\s\\S]*?)</label>`, "i"));
    if (match) return strip(match[1] ?? "");
  }
  const wrapped = html.match(/<label[^>]*>([\s\S]*?)<(input|textarea|select)\b/gi) ?? [];
  for (const block of wrapped) {
    if ((id && block.includes(id)) || (name && block.includes(name))) return strip(block.replace(/<[^>]+>/g, " "));
  }
  return "";
}

function optionsAfter(html: string, selectTag: string) {
  const start = html.indexOf(selectTag);
  const end = html.indexOf("</select>", start);
  const body = end > start ? html.slice(start, end) : "";
  return [...body.matchAll(/<option[^>]*>([\s\S]*?)<\/option>/gi)].map((match) => strip(match[1] ?? "")).filter(Boolean);
}

function attr(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match?.[1] ?? "";
}

function fieldText(field: RawField) {
  return [field.label, field.name, field.id, field.placeholder, field.ariaLabel, field.nearby].filter(Boolean).join(" ");
}

function clip(value: string | null | undefined, max = 180) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function strip(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeReg(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
