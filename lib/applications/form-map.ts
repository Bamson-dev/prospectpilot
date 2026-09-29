import { coarseClass, fieldMetrics, judgeField, resolveFieldAnswer, type FieldTaxonomy } from "@/lib/applications/field-taxonomy";

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
  | "DEMOGRAPHIC"
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
  autocomplete?: string | null;
  section?: string | null;
  options?: string[];
  nearby?: string | null;
  value?: string | null;
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
  section: string;
  classification: FieldClass;
  taxonomy: FieldTaxonomy;
  confidence: number;
  evidence: string[];
};

export type MappedAnswer = {
  name: string;
  classification: FieldClass;
  taxonomy: FieldTaxonomy;
  confidence: number;
  required: boolean;
  status: "ANSWERED" | "REVIEW_REQUIRED" | "UNSUPPORTED";
  value: string | null;
  source: string | null;
  reason: string | null;
};

export function classifyField(field: RawField): FieldClass {
  return coarseClass(judgeField(field).taxonomy);
}

export function inspectFields(fields: RawField[]): InspectedField[] {
  const started = Date.now();
  const inspected = groupControls(fields).filter((field) => !["hidden", "submit", "button", "image"].includes((field.type ?? "").toLowerCase())).map((field) => {
    const judgment = judgeField(field);
    const question = clip(field.label || field.ariaLabel || field.nearby || field.placeholder || "");
    return {
      label: clip(field.label),
      name: clip(field.name),
      id: clip(field.id),
      type: clip(field.type).toLowerCase(),
      required: Boolean(field.required),
      placeholder: clip(field.placeholder),
      ariaLabel: clip(field.ariaLabel),
      options: (field.options ?? []).map((option) => clip(option, 80)).filter(Boolean).slice(0, 30),
      question,
      section: clip(field.section),
      classification: coarseClass(judgment.taxonomy),
      taxonomy: judgment.taxonomy,
      confidence: judgment.confidence,
      evidence: judgment.evidence,
    };
  });
  inspectedTime = Date.now() - started;
  return inspected;
}

let inspectedTime = 0;

export function lastClassificationMs() {
  return inspectedTime;
}

export function mapCandidateToFields(fields: InspectedField[], values: Record<string, string | null | undefined>, verifiedTechnologies: string[] = []) {
  return fields.map((field) => mapOne(field, values, verifiedTechnologies));
}

function mapOne(field: InspectedField, values: Record<string, string | null | undefined>, verifiedTechnologies: string[]): MappedAnswer {
  const judgment = judgeField({ ...field, options: field.options });
  const answer = resolveFieldAnswer({
    judgment,
    required: field.required,
    options: field.options,
    questionText: `${field.label} ${field.ariaLabel} ${field.question} ${field.name} ${field.id}`,
    values,
    verifiedTechnologies,
  });
  return {
    name: field.name || field.id || field.question,
    classification: field.classification,
    taxonomy: field.confidence < 0.85 && field.taxonomy !== "CUSTOM_QUESTION" ? "UNKNOWN" : field.taxonomy,
    confidence: field.confidence,
    required: field.required,
    status: answer.status,
    value: answer.value,
    source: answer.source,
    reason: answer.reason,
  };
}

export function classificationReport(fields: InspectedField[], mapped: MappedAnswer[]) {
  return fieldMetrics(fields.map((field, index) => ({
    taxonomy: field.taxonomy,
    required: field.required,
    status: mapped[index]?.status ?? "REVIEW_REQUIRED",
    confidence: field.confidence,
  })), lastClassificationMs());
}

export function fieldsFromHtml(html: string): RawField[] {
  const fields: RawField[] = [];
  let section = "";
  const pattern = /<(h[1-3]|legend|label|input|textarea|select)\b[^>]*>/gi;
  const marks = [...html.matchAll(pattern)];
  for (let index = 0; index < marks.length; index += 1) {
    const tag = marks[index][0];
    const kind = (marks[index][1] ?? "").toLowerCase();
    if (kind === "h1" || kind === "h2" || kind === "h3" || kind === "legend") {
      const close = html.indexOf(`</${kind}>`, marks[index].index ?? 0);
      section = strip(html.slice((marks[index].index ?? 0) + tag.length, close > 0 ? close : (marks[index].index ?? 0) + tag.length));
      continue;
    }
    if (kind === "label") continue;
    const type = attr(tag, "type") || (kind === "textarea" ? "textarea" : kind === "select" ? "select" : "text");
    if (attr(tag, "aria-hidden") === "true") continue;
    const start = marks[index].index ?? 0;
    const id = attr(tag, "id");
    const name = attr(tag, "name");
    const directLabel = labelFor(html, id, name) || precedingLabel(html, start);
    const label = genericControlLabel(directLabel) ? uploadLabel(html, id) || directLabel : directLabel;
    fields.push({
      id,
      name,
      type,
      value: attr(tag, "value"),
      required: /\brequired\b/i.test(tag) || attr(tag, "aria-required") === "true",
      placeholder: attr(tag, "placeholder"),
      ariaLabel: attr(tag, "aria-label"),
      autocomplete: attr(tag, "autocomplete"),
      section,
      label,
      nearby: strip(html.slice(Math.max(0, start - 180), start)).slice(-160),
      options: kind === "select" ? optionsAfter(html, tag) : [],
    });
  }
  return groupControls(fields);
}

export function groupControls(fields: RawField[]) {
  const grouped = new Map<string, RawField>();
  const ordered: RawField[] = [];
  for (const field of fields) {
    const type = (field.type ?? "").toLowerCase();
    if ((type === "radio" || type === "checkbox") && field.name) {
      const key = `${type}:${field.name}`;
      const existing = grouped.get(key);
      const option = field.label || field.value || "";
      if (existing) {
        existing.options = [...(existing.options ?? []), option].filter(Boolean);
        continue;
      }
      const next = { ...field, options: option ? [option] : [] };
      grouped.set(key, next);
      ordered.push(next);
      continue;
    }
    ordered.push(field);
  }
  return ordered;
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

function genericControlLabel(value: string) {
  return /^(attach|enter manually)$/i.test(value.trim());
}

function uploadLabel(html: string, id: string | null) {
  if (!id) return "";
  const match = html.match(new RegExp(`id=["']upload-label-${escapeReg(id)}["'][^>]*>([\\s\\S]*?)</`, "i"));
  return match ? strip(match[1] ?? "") : "";
}

function precedingLabel(html: string, index: number) {
  const before = html.slice(Math.max(0, index - 400), index);
  const labels = [...before.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi)];
  return labels.length ? strip(labels[labels.length - 1][1] ?? "") : "";
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
