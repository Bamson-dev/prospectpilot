export type InboxPage = { ids: string[]; nextPageToken?: string };

export type InboxCollection = { ids: string[]; pages: number; truncated: boolean };

// Walks Gmail's list pages with nextPageToken. It stops at maxPages, stops if Gmail repeats a token,
// and removes repeated message ids. A page request that throws propagates, so a failed sync never
// looks complete. truncated is true when more pages existed than the limit allowed.
export async function collectInboxMessageIds(
  fetchPage: (pageToken?: string) => Promise<InboxPage>,
  options: { maxPages: number },
): Promise<InboxCollection> {
  const seen = new Set<string>();
  const tokens = new Set<string>();
  let token: string | undefined;
  let pages = 0;
  while (pages < options.maxPages) {
    const page = await fetchPage(token);
    pages += 1;
    for (const id of page.ids) seen.add(id);
    if (!page.nextPageToken) return { ids: [...seen], pages, truncated: false };
    if (tokens.has(page.nextPageToken)) return { ids: [...seen], pages, truncated: true };
    tokens.add(page.nextPageToken);
    token = page.nextPageToken;
  }
  return { ids: [...seen], pages, truncated: true };
}

export function inboxPageSize(value = process.env.INBOX_SYNC_PAGE_SIZE) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 50;
}

export function inboxMaxPages(value = process.env.INBOX_SYNC_MAX_PAGES) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 5;
}
