import type { Page } from "playwright";
import { fetchPublic } from "@/lib/network";

type PublicFetcher = typeof fetchPublic;

export async function routePublicBrowserTraffic(page: Page, fetcher: PublicFetcher = fetchPublic) {
  await page.route("**/*", async (route) => {
    try {
      const response = await fetcher(route.request().url());
      await route.fulfill({ status: response.status, headers: response.headers, body: response.body });
    } catch {
      await route.abort();
    }
  });
  // WebSocket traffic is not covered by page.route. Do not let inspected pages
  // open direct connections from the worker network.
  await page.routeWebSocket("**/*", (socket) => socket.close());
}
