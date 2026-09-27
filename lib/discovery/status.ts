export type DiscoverySourceState = "Connected" | "Disabled" | "Not configured" | "Unavailable" | "Error";

export function discoverySourceCatalog(): Array<{ name: string; state: DiscoverySourceState; detail: string }> {
  const searx = process.env.SEARXNG_ENABLED === "true" && Boolean(process.env.SEARXNG_URL?.trim());
  return [
    { name: "SearXNG", state: searx ? "Connected" : "Not configured", detail: "Search aggregation" },
    { name: "Directories", state: process.env.DIRECTORY_DISCOVERY_ENABLED === "true" ? "Connected" : "Disabled", detail: "Public directory queries" },
    { name: "Maps", state: "Disabled", detail: "No map provider is configured" },
    { name: "Social", state: process.env.SOCIAL_DISCOVERY_ENABLED === "true" ? "Connected" : "Disabled", detail: "Public business profiles only" },
    { name: "Browser Search", state: process.env.BROWSER_SEARCH_ENABLED === "true" ? "Connected" : "Disabled", detail: "Playwright fallback for search pages" },
    { name: "Google CSE", state: process.env.GOOGLE_CSE_ENABLED === "true" ? "Connected" : "Disabled", detail: "Custom Search JSON API" },
    { name: "Brave", state: "Not configured", detail: "Optional future provider. No API key is required." },
  ];
}
