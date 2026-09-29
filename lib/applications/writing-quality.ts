const GENERIC = [
  "i am excited to apply",
  "i am thrilled to apply",
  "i am writing to express",
  "i would like to apply",
  "i believe i am the perfect candidate",
  "i am confident that",
  "i am passionate about",
  "i would love the opportunity",
  "i bring a unique combination",
  "i have a proven track record",
  "results-driven professional",
  "dynamic professional",
  "highly motivated",
  "detail-oriented professional",
  "leverage my skills",
  "drive synergies",
  "cutting-edge",
  "transformative impact",
  "aligns perfectly",
  "valuable asset",
];

export function assessWriting(input: {
  text: string;
  jobDescription?: string;
  recentOpenings?: string[];
  recentClosings?: string[];
  unsupportedClaims?: string[];
}) {
  const text = input.text.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const generic = GENERIC.filter((phrase) => lower.includes(phrase));
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const repeated = repeatedPhrases(lower);
  const overlap = copiedSentences(text, input.jobDescription ?? "");
  const opening = firstSentence(text);
  const closing = sentences.at(-1) ?? "";
  const openingReuse = (input.recentOpenings ?? []).some((item) => normalize(item) === normalize(opening));
  const closingReuse = (input.recentClosings ?? []).some((item) => normalize(item) === normalize(closing) && normalize(closing).length > 12);
  const lengths = sentences.map((sentence) => sentence.split(/\s+/).length);
  const variance = varianceOf(lengths);
  const paragraphs = input.text.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  const paragraphVariance = varianceOf(paragraphs.map((item) => item.split(/\s+/).length));
  const stuffing = keywordStuffing(lower);
  const unsupported = input.unsupportedClaims ?? [];
  const corporate = generic.length;
  const review = generic.length > 0 || repeated.length > 0 || overlap.length > 0 || openingReuse || stuffing || unsupported.length > 0 || sameShape(lengths);
  return {
    generic_phrase_count: generic.length,
    repeated_phrase_count: repeated.length,
    job_description_overlap: overlap.length,
    sentence_length_variance: Number(variance.toFixed(2)),
    paragraph_length_variance: Number(paragraphVariance.toFixed(2)),
    opening_reuse: openingReuse,
    closing_reuse: closingReuse,
    keyword_stuffing: stuffing,
    corporate_language: corporate,
    unsupported_claim_count: unsupported.length,
    status: review ? "REVIEW_REQUIRED" as const : "PASS" as const,
  };
}

export function humanRewrite(text: string) {
  let next = text.replace(/\u2014/g, ", ");
  const replacements: Array<[RegExp, string]> = [
    [/\bi am excited to apply\b/gi, "I am applying"],
    [/\bi am thrilled to apply\b/gi, "I am applying"],
    [/\bi am writing to express my interest\b/gi, "I am applying"],
    [/\bi believe i am the perfect candidate\b/gi, "The work I can point to is on file"],
    [/\bi bring a unique combination\b/gi, "The relevant work is"],
    [/\bi have a proven track record\b/gi, "The record I can point to is"],
    [/\bresults-driven professional\b/gi, "the work"],
    [/\bdynamic professional\b/gi, "the work"],
    [/\bleverage my skills\b/gi, "use the work already on file"],
    [/\bcutting-edge\b/gi, "current"],
    [/\baligns perfectly\b/gi, "matches"],
  ];
  for (const [pattern, replacement] of replacements) next = next.replace(pattern, replacement);
  return next.replace(/[ ]{2,}/g, " ").trim();
}

const COMMON_WORDS = new Set(["a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "with", "this", "that", "role", "work", "application", "web", "about", "interested", "excited", "opportunity"]);

function repeatedPhrases(text: string) {
  const words = text.split(/\s+/);
  const counts = new Map<string, number>();
  for (let index = 0; index < words.length - 4; index += 1) {
    const slice = words.slice(index, index + 5);
    const distinctive = slice.filter((word) => word.length > 4 && !COMMON_WORDS.has(word));
    if (distinctive.length < 2) continue;
    const phrase = slice.join(" ");
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([phrase]) => phrase);
}

function copiedSentences(text: string, job: string) {
  if (!job.trim()) return [];
  const source = new Set(job.split(/(?<=[.!?])\s+/).map(normalize).filter((item) => item.split(" ").length >= 8));
  return text.split(/(?<=[.!?])\s+/).map(normalize).filter((item) => source.has(item));
}

function keywordStuffing(text: string) {
  const counts = new Map<string, number>();
  for (const word of text.split(/[^a-z0-9+#.]+/).filter((item) => item.length > 3)) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count > 6);
}

function sameShape(lengths: number[]) {
  if (lengths.length < 4) return false;
  return Math.max(...lengths) - Math.min(...lengths) <= 1;
}

function varianceOf(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function firstSentence(text: string) {
  return text.split(/(?<=[.!?])\s+/)[0] ?? "";
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
