import { matchesQuery } from "@/lib/applications/job-normalize";
import { discoveryBlock, type DiscoveredJob } from "@/lib/applications/providers";
import { parseJobPage } from "@/lib/applications/providers";
import { searxngEnabled, searxngSearch, parseSearxngResults } from "@/lib/discovery/searxng";
import type { RawDiscoveredVacancy } from "@/lib/applications/job-normalize";

export type SourceFailure = { source: string; reason: string };

export type SourceCollection = {
  jobs: RawDiscoveredVacancy[];
  failures: SourceFailure[];
};

const BOARDS = [
  { source: "greenhouse", board: "gitlab" },
  { source: "lever", board: "spotify" },
] as const;

export async function collectPublicVacancies(input: { query: string; limit: number; fetchImpl?: typeof fetch }): Promise<SourceCollection> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const jobs: RawDiscoveredVacancy[] = [];
  const failures: SourceFailure[] = [];
  const perBoard = Math.max(5, Math.ceil(input.limit / BOARDS.length));
  for (const board of BOARDS) {
    if (jobs.length >= input.limit) break;
    const room = Math.min(perBoard, input.limit - jobs.length);
    const found = board.source === "greenhouse"
      ? await greenhouseBoard(fetchImpl, board.board, room, input.query)
      : await leverBoard(fetchImpl, board.board, room, input.query);
    jobs.push(...found.jobs);
    failures.push(...found.failures);
  }
  if (searxngEnabled()) {
    const searched = await searxngVacancies(input.query, Math.min(10, input.limit));
    jobs.push(...searched.jobs);
    failures.push(...searched.failures);
  } else {
    failures.push({ source: "searxng", reason: "not configured" });
  }
  return { jobs, failures };
}

async function greenhouseBoard(fetchImpl: typeof fetch, board: string, limit: number, query: string): Promise<SourceCollection> {
  const listUrl = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs`;
  const list = await readJson(fetchImpl, listUrl);
  if (list.failure) return { jobs: [], failures: [{ source: `greenhouse:${board}`, reason: list.failure }] };
  const rows = Array.isArray((list.body as { jobs?: unknown }).jobs) ? (list.body as { jobs: unknown[] }).jobs : [];
  const jobs: RawDiscoveredVacancy[] = [];
  for (const row of rows) {
    if (jobs.length >= limit) break;
    if (!row || typeof row !== "object") continue;
    const item = row as { id?: unknown; title?: unknown };
    if ((typeof item.id !== "number" && typeof item.id !== "string") || !matchesTitle(item.title, query)) continue;
    const detail = await readJson(fetchImpl, `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${item.id}`);
    if (detail.failure) {
      return { jobs, failures: [{ source: `greenhouse:${board}`, reason: detail.failure }] };
    }
    const job = greenhouseJob(detail.body);
    if (job) jobs.push(job);
    await delay(200);
  }
  return { jobs, failures: [] };
}

async function leverBoard(fetchImpl: typeof fetch, board: string, limit: number, query: string): Promise<SourceCollection> {
  const list = await readJson(fetchImpl, `https://api.lever.co/v0/postings/${board}?mode=json`);
  if (list.failure) return { jobs: [], failures: [{ source: `lever:${board}`, reason: list.failure }] };
  if (!Array.isArray(list.body)) return { jobs: [], failures: [{ source: `lever:${board}`, reason: "unexpected response" }] };
  const jobs: RawDiscoveredVacancy[] = [];
  for (const row of list.body) {
    if (jobs.length >= limit) break;
    const job = leverJob(board, row);
    if (job && matchesTitle(job.title, query)) jobs.push(job);
  }
  return { jobs, failures: [] };
}

export function greenhouseJob(value: unknown): RawDiscoveredVacancy | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = text(row.title);
  const url = text(row.absolute_url);
  const company = text(row.company_name);
  const content = text(row.content);
  if (!title || !url || !company || !content) return null;
  const location = row.location && typeof row.location === "object" ? text((row.location as { name?: unknown }).name) : "";
  return {
    source: "greenhouse",
    sourceUrl: url,
    applicationUrl: url,
    externalId: row.id == null ? null : String(row.id),
    companyName: company,
    title,
    location: location || null,
    employmentType: metadataValue(row.metadata, /employment type|commitment/i),
    description: content,
    originalDescription: content,
    postedAt: text(row.first_published) || null,
  };
}

export function leverJob(board: string, value: unknown): RawDiscoveredVacancy | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = text(row.text);
  const url = text(row.hostedUrl);
  const apply = text(row.applyUrl) || url;
  const description = text(row.descriptionPlain) || text(row.description);
  if (!title || !url || !apply || !description) return null;
  const categories = row.categories && typeof row.categories === "object" ? row.categories as Record<string, unknown> : {};
  const created = typeof row.createdAt === "number" ? new Date(row.createdAt).toISOString() : null;
  return {
    source: "lever",
    sourceUrl: url,
    applicationUrl: apply,
    externalId: text(row.id) || null,
    companyName: board,
    title,
    location: text(categories.location) || null,
    employmentType: text(categories.commitment) || null,
    workplaceType: text(row.workplaceType) || null,
    description,
    originalDescription: text(row.description) || description,
    postedAt: created,
  };
}

async function searxngVacancies(query: string, limit: number): Promise<SourceCollection> {
  try {
    const payload = await searxngSearch({ query: `${query} job`, limit, language: "en" });
    const jobs = parseSearxngResults(payload, query, limit).flatMap((hit) => {
      const parsed: DiscoveredJob | null = parseJobPage({ url: hit.url, title: hit.title, text: `${hit.title}. ${hit.snippet}`.padEnd(40, ".") });
      if (!parsed) return [];
      return [{
        source: parsed.source,
        sourceUrl: parsed.sourceUrl,
        applicationUrl: parsed.applicationUrl,
        companyName: parsed.companyName,
        title: parsed.title,
        location: parsed.location ?? null,
        description: parsed.description,
        originalDescription: parsed.description,
      }];
    });
    return { jobs, failures: [] };
  } catch (error) {
    return { jobs: [], failures: [{ source: "searxng", reason: error instanceof Error ? error.message : "unavailable" }] };
  }
}

async function readJson(fetchImpl: typeof fetch, url: string) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" }, redirect: "follow" });
    const bodyText = await response.text();
    const blocked = discoveryBlock(response.status, bodyText);
    if (blocked || !response.ok) return { body: null, failure: blocked ?? `HTTP ${response.status}` };
    try {
      return { body: JSON.parse(bodyText) as unknown, failure: null as string | null };
    } catch {
      return { body: null, failure: "unexpected response" };
    }
  } catch (error) {
    return { body: null, failure: error instanceof Error ? error.message : "unavailable" };
  }
}

function metadataValue(value: unknown, pattern: RegExp) {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; value?: unknown };
    if (typeof row.name === "string" && pattern.test(row.name) && typeof row.value === "string" && row.value.trim() && row.value.trim().toLowerCase() !== "n/a") {
      return row.value.trim();
    }
  }
  return null;
}

function matchesTitle(title: unknown, query: string) {
  return typeof title === "string" && matchesQuery({ title, description: "" }, query);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
