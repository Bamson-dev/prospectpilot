const BANNED = [
  "i am excited to apply",
  "i am passionate",
  "delighted to",
  "thrilled to",
  "synergy",
  "leverage",
  "dynamic professional",
  "results-driven",
  "team player",
  "go-getter",
];

export function bannedPhrases(text: string) {
  const lower = text.toLowerCase();
  return BANNED.filter((phrase) => lower.includes(phrase));
}

export function writingRules() {
  return {
    tone: "direct",
    formality: "professional",
    verbosity: "short paragraphs",
    voice: "Specific evidence, no stock enthusiasm, no repeated openings.",
    samples: [
      "I am applying for this role.",
      "The record I can point to is work that is already verified.",
      "Where a requirement is not on file, I have left it open.",
    ],
  };
}
