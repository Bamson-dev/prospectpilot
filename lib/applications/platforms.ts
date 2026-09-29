export type PlatformName = "GREENHOUSE" | "LEVER" | "ASHBY" | "WORKABLE" | "SMARTRECRUITERS" | "GENERIC" | "UNKNOWN";

const HOSTS: Array<{ name: Exclude<PlatformName, "GENERIC" | "UNKNOWN">; pattern: RegExp }> = [
  { name: "GREENHOUSE", pattern: /(^|\.)greenhouse\.io$/i },
  { name: "LEVER", pattern: /(^|\.)lever\.co$/i },
  { name: "ASHBY", pattern: /(^|\.)ashbyhq\.com$/i },
  { name: "WORKABLE", pattern: /(^|\.)workable\.com$/i },
  { name: "SMARTRECRUITERS", pattern: /(^|\.)smartrecruiters\.com$/i },
];

export function detectPlatform(input: { url: string; html?: string }): PlatformName {
  const host = hostname(input.url);
  if (!host && !input.html) return "UNKNOWN";
  const fromHost = HOSTS.find((item) => item.pattern.test(host));
  if (fromHost) return fromHost.name;
  const structure = atsFromStructure(input.html ?? "");
  if (structure) return structure;
  if (!host) return "UNKNOWN";
  return "GENERIC";
}

function atsFromStructure(html: string) {
  const sources = [...html.matchAll(/(?:src|action|href)=["']([^"']+)["']/gi)].map((match) => match[1] ?? "");
  for (const source of sources) {
    const host = hostname(source);
    const match = HOSTS.find((item) => item.pattern.test(host));
    if (match) return match.name;
  }
  return null;
}

function hostname(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}
