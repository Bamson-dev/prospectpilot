export type PageSignals = {
  services: string[];
  technology: string[];
  advertising: string[];
  callsToAction: string[];
  forms: number;
  emails: string[];
  phones: string[];
  socialUrls: string[];
};

const TECH_PATTERNS: Array<[string, RegExp]> = [
  ["WordPress", /wp-content|wordpress/i],
  ["Shopify", /cdn\.shopify|myshopify/i],
  ["Wix", /wix\.com|wixstatic/i],
  ["Squarespace", /squarespace/i],
  ["Webflow", /webflow/i],
  ["HubSpot", /hs-scripts|hubspot/i],
  ["Salesforce", /salesforce|pardot/i],
  ["Google Analytics", /google-analytics|gtag\(|googletagmanager/i],
  ["Meta Pixel", /fbq\(|connect\.facebook\.net/i],
  ["Intercom", /intercom/i],
  ["Crisp", /crisp\.chat/i],
  ["Calendly", /calendly/i],
  ["Stripe", /js\.stripe\.com/i],
];

export function extractPage(html: string, pageUrl: string): {
  title: string | null;
  metaDescription: string | null;
  headings: string[];
  excerpt: string;
  signals: PageSignals;
} {
  const title = matchOne(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription = matchOne(
    html,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ) || matchOne(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => visibleText(match[1] ?? ""))
    .filter((item) => item.length > 1)
    .slice(0, 20);
  const text = visibleText(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
  const mailto = [...html.matchAll(/mailto:([^"'?\s>]+)/gi)].map((match) => match[1] ?? "");
  const emails = unique([...(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []), ...mailto])
    .filter((email) => !email.endsWith(".png") && !email.includes("example.com"))
    .slice(0, 8);
  const phones = unique(text.match(/\+?\d[\d\s().-]{7,}\d/g) ?? []).slice(0, 5);
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((match) => absolute(pageUrl, match[1] ?? ""));
  const socialUrls = hrefs.filter((href) => /linkedin\.com|facebook\.com|instagram\.com/i.test(href)).slice(0, 8);
  const technology = TECH_PATTERNS.filter(([, pattern]) => pattern.test(html)).map(([name]) => name);
  const advertising = technology.filter((item) => item === "Meta Pixel" || item === "Google Analytics");
  const callsToAction = [...html.matchAll(/<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)]
    .map((match) => visibleText(match[1] ?? ""))
    .filter((item) => /book|contact|quote|demo|call|get started|sign up|buy|shop/i.test(item))
    .slice(0, 8);
  const forms = (html.match(/<form\b/gi) ?? []).length;
  return {
    title,
    metaDescription,
    headings,
    excerpt: text.slice(0, 6000),
    signals: {
      services: headings.slice(0, 8),
      technology,
      advertising,
      callsToAction: unique(callsToAction),
      forms,
      emails,
      phones,
      socialUrls,
    },
  };
}

function matchOne(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  const value = visibleText(match?.[1] ?? "");
  return value || null;
}

function visibleText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function absolute(pageUrl: string, href: string) {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return href;
  }
}

export function pageLooksThin(excerpt: string) {
  return excerpt.trim().length < 280;
}
