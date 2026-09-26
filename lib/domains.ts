const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "google.com",
  "goo.gl",
  "maps.google.com",
];

export function registrableHost(input: string | null | undefined) {
  if (!input) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const host = new URL(withProtocol).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
    if (!host.includes(".")) return null;
    return host;
  } catch {
    return null;
  }
}

export function isSocialHost(host: string) {
  return SOCIAL_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
}

export function websiteFromUrl(input: string) {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = registrableHost(url.hostname);
    if (!host || isSocialHost(host)) return null;
    return { domain: host, website: `${url.protocol}//${url.hostname}${url.pathname === "/" ? "" : url.pathname}` };
  } catch {
    return null;
  }
}

export function socialLinks(urls: string[]) {
  const links: { linkedinUrl?: string; facebookUrl?: string; instagramUrl?: string } = {};
  for (const value of urls) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (host.includes("linkedin.com") && !links.linkedinUrl) links.linkedinUrl = url.toString();
      if (host.includes("facebook.com") && !links.facebookUrl) links.facebookUrl = url.toString();
      if (host.includes("instagram.com") && !links.instagramUrl) links.instagramUrl = url.toString();
    } catch {
      continue;
    }
  }
  return links;
}

export function cleanCompanyName(title: string) {
  return title
    .replace(/\s+[|\-–—]\s+(home|official site|official website|website).*$/i, "")
    .replace(/\s+[|\-–—]\s+.*$/, (match) => (match.length > 48 ? "" : match))
    .trim()
    .slice(0, 160);
}
