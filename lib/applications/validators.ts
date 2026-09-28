import type { CandidateRecord } from "@/lib/applications/types";

export function DateValidator(text: string, candidate: CandidateRecord) {
  const years = text.match(/\b(19|20)\d{2}\b/g) ?? [];
  const known = new Set<string>();
  for (const item of [...candidate.facts, ...candidate.experiences]) {
    const start = "startDate" in item ? item.startDate : undefined;
    const end = "endDate" in item ? item.endDate : undefined;
    if (start instanceof Date) known.add(String(start.getUTCFullYear()));
    if (end instanceof Date) known.add(String(end.getUTCFullYear()));
  }
  const unknown = years.filter((year) => !known.has(year));
  return { ok: unknown.length === 0, problems: unknown };
}

export function FormattingValidator(text: string) {
  const problems: string[] = [];
  if (!text.includes("Summary") || !text.includes("Experience") || !text.includes("Skills")) problems.push("missing standard headings");
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 40);
  if (lines.some((line, index) => lines.indexOf(line) !== index)) problems.push("obvious duplication");
  return { ok: problems.length === 0, problems };
}

export function RequirementCoverageValidator(text: string, matched: string[]) {
  const covered = matched.filter((item) => item.split(/\s+/).filter((word) => word.length > 4).some((word) => text.toLowerCase().includes(word.toLowerCase())));
  return { covered: covered.length, total: matched.length };
}
