const NAMED: Array<{ name: string; pattern: RegExp }> = [
  { name: "typescript", pattern: /\b(?:typescript|ts)\b/gi },
  { name: "javascript", pattern: /\b(?:javascript|js)\b/gi },
  { name: "postgresql", pattern: /\b(?:postgresql|postgres)\b/gi },
  { name: "next.js", pattern: /\bnext\.?js\b/gi },
  { name: "node.js", pattern: /\bnode\.?js\b/gi },
  { name: "react", pattern: /\breact(?:\.?js)?\b/gi },
  { name: "vue", pattern: /\bvue(?:\.?js)?\b/gi },
  { name: "angular", pattern: /\bangular(?:\.?js)?\b/gi },
  { name: "python", pattern: /\bpython\b/gi },
  { name: "redis", pattern: /\bredis\b/gi },
  { name: "prisma", pattern: /\bprisma\b/gi },
  { name: "playwright", pattern: /\bplaywright\b/gi },
  { name: "tailwind", pattern: /\btailwind\b/gi },
  { name: "scrapy", pattern: /\bscrapy\b/gi },
  { name: "bullmq", pattern: /\bbullmq\b/gi },
  { name: "graphql", pattern: /\bgraphql\b/gi },
  { name: "kubernetes", pattern: /\bkubernetes\b/gi },
  { name: "docker", pattern: /\bdocker\b/gi },
  { name: "aws", pattern: /\baws\b/gi },
  { name: "sql", pattern: /\bsql\b/gi },
  { name: "html", pattern: /\bhtml\b/gi },
  { name: "css", pattern: /\bcss\b/gi },
  { name: "wordpress", pattern: /\bwordpress\b/gi },
  { name: "figma", pattern: /\bfigma\b/gi },
  { name: "ruby", pattern: /\bruby\b/gi },
  { name: "kotlin", pattern: /\bkotlin\b/gi },
  { name: "swift", pattern: /\bswift\b/gi },
  { name: "android", pattern: /\bandroid\b/gi },
  { name: "golang", pattern: /\bgolang\b/gi },
  { name: "php", pattern: /\bphp\b/gi },
  { name: "rust", pattern: /\brust\b/gi },
  { name: "java", pattern: /\bjava\b/gi },
  { name: "c#", pattern: /\bc#\b/gi },
];

const ALIASES: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  js: "javascript",
  javascript: "javascript",
  postgres: "postgresql",
  postgresql: "postgresql",
  nextjs: "next.js",
  nodejs: "node.js",
  reactjs: "react",
  vuejs: "vue",
  angularjs: "angular",
  golang: "golang",
};

export function canonicalTechnology(value: string) {
  const compact = value.toLowerCase().replace(/[^a-z0-9+#]+/g, "");
  return ALIASES[compact] ?? compact;
}

export function sameTechnology(left: string, right: string) {
  const wanted = canonicalTechnology(left);
  const found = canonicalTechnology(right);
  return wanted.length > 1 && wanted === found;
}

export function technologiesMentioned(text: string) {
  const found: Array<{ name: string; index: number }> = [];
  for (const item of NAMED) {
    for (const match of text.matchAll(item.pattern)) {
      if (match.index == null) continue;
      found.push({ name: item.name, index: match.index });
    }
  }
  found.sort((left, right) => left.index - right.index);
  const names: string[] = [];
  for (const item of found) {
    if (!names.includes(item.name)) names.push(item.name);
  }
  return names;
}
