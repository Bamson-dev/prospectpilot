import type { SearchHit } from "@/lib/search/types";

function decode(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string) {
  return decode(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function parseGoogleResults(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const pattern = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && hits.length < limit) {
    const rawHref = decode(match[1] ?? "");
    const url = extractResultUrl(rawHref);
    if (!url || seen.has(url)) continue;
    const title = stripTags(match[2] ?? "");
    if (title.length < 2) continue;
    seen.add(url);
    const snippet = snippetNear(html, match.index);
    hits.push({ title, url, snippet });
  }
  return hits;
}

function extractResultUrl(href: string) {
  if (href.startsWith("/url?")) {
    const params = new URLSearchParams(href.slice(5));
    const target = params.get("q") || params.get("url");
    if (!target) return null;
    return acceptable(target);
  }
  return acceptable(href);
}

function acceptable(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "google.com" || host.endsWith(".google.com") || host === "webcache.googleusercontent.com") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function snippetNear(html: string, index: number) {
  const window = html.slice(index, index + 700);
  const snippet = window.match(/<(?:div|span)[^>]*class="[^"]*(?:VwiC3b|st|IsZvec)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/i);
  return snippet ? stripTags(snippet[1] ?? "").slice(0, 320) : "";
}
