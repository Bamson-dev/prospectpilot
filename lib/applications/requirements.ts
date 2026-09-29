import type { ExtractedRequirement, RequirementKind, RequirementRole } from "@/lib/applications/types";
import { technologiesMentioned } from "@/lib/applications/technologies";

const YEAR = /(\d{1,2})\+?\s*(?:years|yrs)/i;

type Section = "intro" | "requirement" | "preferred" | "responsibility" | "context";

export function extractRequirements(description: string): ExtractedRequirement[] {
  const lines = plainText(description)
    .split(/\n+/)
    .flatMap((line) => sentences(line.replace(/^[\s*\-•]+/, "").trim()))
    .filter((line) => line.length > 2);
  const found: ExtractedRequirement[] = [];
  let section: Section = "intro";
  for (const line of lines.length ? lines : [description]) {
    const next = sectionFor(line);
    if (next) {
      section = next;
      continue;
    }
    const item = classifyRequirement(line, section);
    if (item) found.push(item);
  }
  return dedupeRequirements(found);
}

function sentences(line: string) {
  const parts = line.split(/(?<=[.!?])\s+(?=[A-Z])/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [line];
}

function sectionFor(line: string): Section | null {
  const lower = normalizeWording(line);
  if (lower.length > 90) return null;
  if (/what you'?ll do|what you will do|responsibilities|your role|day to day/.test(lower)) return "responsibility";
  if (/preferred requirements|nice to have|bonus points|nice-to-have/.test(lower)) return "preferred";
  if (/what you'?ll bring|what you bring|requirements|qualifications|what we'?re looking|minimum qualifications|basic qualifications/.test(lower)) return "requirement";
  if (/about the team|about us|benefits|compensation|equal opportunity|what we offer|how .+ supports/.test(lower)) return "context";
  return null;
}

function classifyRequirement(line: string, section: Section): ExtractedRequirement | null {
  const lower = normalizeWording(line);
  if (section === "context" || boilerplate(lower)) return null;
  if (section === "responsibility") return duty(line);
  const preferred = section === "preferred" || /preferred|nice to have|bonus|optional|helpful|a plus|advantageous|willingness to learn|not required|do not need|don't need/.test(lower);
  const familiarity = /familiarity|familiar with|exposure to/.test(lower) && !/required|must|proficiency|proficient/.test(lower);
  const years = line.match(YEAR);
  if (years && (section === "requirement" || section === "preferred" || /required|must|preferred|minimum|at least|experience/.test(lower))) {
    return item(line, "EXPERIENCE_YEARS", preferred || familiarity ? "PREFERRED_REQUIREMENT" : "HARD_REQUIREMENT", Number(years[1]));
  }
  if (/\b(bachelor|master'?s|masters|phd|mba|degree|university)\b/.test(lower)) {
    return item(line, "EDUCATION", preferred ? "PREFERRED_REQUIREMENT" : "HARD_REQUIREMENT");
  }
  if (/sponsor|work authorization|authorized to work|eligible to work|\bvisa\b/.test(lower)) {
    return item(line, "MUST_HAVE", preferred ? "PREFERRED_REQUIREMENT" : "HARD_REQUIREMENT");
  }
  if (/must be (located|based|resident)|must reside|only open to residents/.test(lower)) {
    return item(line, "LOCATION", "HARD_REQUIREMENT");
  }
  if (isDuty(lower) && !/proficiency|proficient|experience with|experience in|experience building|required|must|\byears\b|\byrs\b/.test(lower)) {
    return duty(line);
  }
  const techs = technologiesMentioned(line);
  const concrete = /proficiency|proficient|experience with|experience in|experience building|knowledge of|required|must|skills?\b|at least one/.test(lower);
  if (techs.length && (concrete || preferred || section === "requirement")) {
    const role = preferred || familiarity ? "PREFERRED_REQUIREMENT" : "HARD_REQUIREMENT";
    return item(line, "TECHNOLOGY", role);
  }
  if (/strong communication|communication skills|stakeholder management/.test(lower)) {
    return item(line, "SOFT_SKILL", /required|must/.test(lower) && !preferred ? "HARD_REQUIREMENT" : "PREFERRED_REQUIREMENT");
  }
  if (/experience with|experience in|experience building/.test(lower)) {
    return item(line, "INDUSTRY", preferred || familiarity ? "PREFERRED_REQUIREMENT" : "HARD_REQUIREMENT");
  }
  if (isDuty(lower) && lower.length < 280) return duty(line);
  return null;
}

function duty(line: string): ExtractedRequirement {
  return item(line, "RESPONSIBILITY", "RESPONSIBILITY");
}

function item(line: string, kind: RequirementKind, role: RequirementRole, years?: number): ExtractedRequirement {
  const certainty = role === "RESPONSIBILITY"
    ? "responsibility"
    : role === "PREFERRED_REQUIREMENT"
      ? "preferred"
      : role === "HARD_REQUIREMENT"
        ? "required"
        : "uncertain";
  return {
    kind,
    text: line,
    years,
    required: role === "HARD_REQUIREMENT",
    certainty,
    role,
  };
}

function isDuty(lower: string) {
  return /you will|you'll|responsible for/.test(lower) || /^(build|design|develop|collaborate|work with|partner with|own|write|review|implement|maintain)\b/.test(lower);
}

function boilerplate(lower: string) {
  return /equal opportunity|affirmative action|employee stock|equity compensation|registered trademark|please note that we welcome/.test(lower);
}

function normalizeWording(line: string) {
  return line.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
}

function dedupeRequirements(items: ExtractedRequirement[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function plainText(value: string) {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/&nbsp;/gi, " ")
    .replace(/<li[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|ul|ol|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function technologiesInText(text: string) {
  return technologiesMentioned(text);
}
