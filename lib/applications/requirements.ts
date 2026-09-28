import type { ExtractedRequirement, RequirementKind } from "@/lib/applications/types";

const TECH = [
  "typescript", "javascript", "react", "next.js", "nextjs", "node", "postgresql", "postgres", "prisma",
  "redis", "python", "playwright", "sql", "html", "css", "wordpress", "figma",
];

const YEAR = /(\d{1,2})\+?\s*(?:years|yrs)/i;

export function extractRequirements(description: string): ExtractedRequirement[] {
  const lines = plainText(description)
    .split(/\n+/)
    .map((line) => line.replace(/^[\s*\-•]+/, "").trim())
    .filter((line) => line.length > 2);
  const found: ExtractedRequirement[] = [];
  for (const line of lines.length ? lines : [description]) {
    const lower = line.toLowerCase();
    const years = line.match(YEAR);
    const preferred = /preferred|nice to have|bonus|plus|optional/.test(lower);
    const required = /required|must|minimum|at least/.test(lower) && !preferred;
    if (years) {
      found.push({
        kind: "EXPERIENCE_YEARS",
        text: line,
        years: Number(years[1]),
        required,
      });
    }
    const kind = classifyLine(lower, preferred, required);
    if (kind) {
      const hard = kind === "MUST_HAVE" || kind === "EDUCATION" || (kind === "TECHNOLOGY" && required);
      found.push({ kind, text: line, required: preferred ? false : hard });
    }
  }
  return dedupeRequirements(found);
}

function classifyLine(lower: string, preferred: boolean, required: boolean): RequirementKind | null {
  if (/bachelor|degree|university|certification/.test(lower)) return preferred ? "NICE_TO_HAVE" : "EDUCATION";
  if (/remote|hybrid|on-?site/.test(lower)) return "REMOTE_POLICY";
  if (/full-time|part-time|contract|permanent/.test(lower)) return "EMPLOYMENT_TYPE";
  if (/salary|compensation|\$|£|€/.test(lower)) return "SALARY";
  if (/greenhouse|lever|ashby|workable|smartrecruiters|apply/.test(lower) && /http|platform|via/.test(lower)) return "APPLICATION_PLATFORM";
  if (TECH.some((item) => lower.includes(item))) return "TECHNOLOGY";
  if (/responsib|you will|own the|build /.test(lower)) return "RESPONSIBILITY";
  if (preferred) return "NICE_TO_HAVE";
  if (required) return "MUST_HAVE";
  return null;
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
  const lower = text.toLowerCase();
  return TECH.filter((item) => lower.includes(item));
}
