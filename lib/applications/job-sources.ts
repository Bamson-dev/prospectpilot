import { matchesQuery } from "@/lib/applications/job-normalize";
import { discoveryBlock } from "@/lib/applications/providers";
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
  { source: "ashby", board: "reddit" },
  { source: "workable", board: "revolut" },
  { source: "smartrecruiters", board: "square" },
] as const;

export async function collectPublicVacancies(input: { query: string; limit: number; fetchImpl?: typeof fetch }): Promise<SourceCollection> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const jobs: RawDiscoveredVacancy[] = [];
  const failures: SourceFailure[] = [];
  const perBoard = Math.max(5, Math.ceil(input.limit / BOARDS.length));
  for (const board of BOARDS) {
    if (jobs.length >= input.limit) break;
    const room = Math.min(perBoard, input.limit - jobs.length);
    let found: SourceCollection = { jobs: [], failures: [] };
    if (board.source === "greenhouse") found = await greenhouseBoard(fetchImpl, board.board, room, input.query);
    else if (board.source === "lever") found = await leverBoard(fetchImpl, board.board, room, input.query);
    else if (board.source === "ashby") found = await ashbyBoard(fetchImpl, board.board, room, input.query);
    else if (board.source === "workable") found = await workableBoard(fetchImpl, board.board, room, input.query);
    else if (board.source === "smartrecruiters") found = await smartRecruitersBoard(fetchImpl, board.board, room, input.query);
    
    jobs.push(...found.jobs);
    failures.push(...found.failures);
    
    // Continue to next provider if one hits a rate limit instead of breaking the entire discovery run
    if (found.failures.some(f => f.reason.includes("429") || f.reason.includes("rate limit"))) {
      continue; 
    }
  }
  if (searxngEnabled()) {
    const searched = await searxngVacancies(input.query, input.limit, fetchImpl);
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

async function ashbyBoard(fetchImpl: typeof fetch, board: string, limit: number, query: string): Promise<SourceCollection> {
  const list = await readJson(fetchImpl, `https://api.ashbyhq.com/posting-api/job-board/${board}`);
  if (list.failure) return { jobs: [], failures: [{ source: `ashby:${board}`, reason: list.failure }] };
  const rows = Array.isArray((list.body as { jobs?: unknown }).jobs) ? (list.body as { jobs: unknown[] }).jobs : [];
  const jobs: RawDiscoveredVacancy[] = [];
  for (const row of rows) {
    if (jobs.length >= limit) break;
    const job = ashbyJob(board, row);
    if (job && matchesTitle(job.title, query)) jobs.push(job);
  }
  return { jobs, failures: [] };
}

async function workableBoard(fetchImpl: typeof fetch, board: string, limit: number, query: string): Promise<SourceCollection> {
  const list = await readJson(fetchImpl, `https://apply.workable.com/api/v3/accounts/${board}/jobs`);
  if (list.failure) return { jobs: [], failures: [{ source: `workable:${board}`, reason: list.failure }] };
  const rows = Array.isArray((list.body as { results?: unknown }).results) ? (list.body as { results: unknown[] }).results : [];
  const jobs: RawDiscoveredVacancy[] = [];
  for (const row of rows) {
    if (jobs.length >= limit) break;
    const job = workableJob(board, row);
    if (job && matchesTitle(job.title, query)) jobs.push(job);
  }
  return { jobs, failures: [] };
}

async function smartRecruitersBoard(fetchImpl: typeof fetch, board: string, limit: number, query: string): Promise<SourceCollection> {
  const list = await readJson(fetchImpl, `https://api.smartrecruiters.com/v1/companies/${board}/postings`);
  if (list.failure) return { jobs: [], failures: [{ source: `smartrecruiters:${board}`, reason: list.failure }] };
  const rows = Array.isArray((list.body as { content?: unknown }).content) ? (list.body as { content: unknown[] }).content : [];
  const jobs: RawDiscoveredVacancy[] = [];
  for (const row of rows) {
    if (jobs.length >= limit) break;
    if (!row || typeof row !== "object") continue;
    const item = row as { id?: unknown; name?: unknown };
    if (typeof item.id !== "string" || !matchesTitle(item.name, query)) continue;
    const detail = await readJson(fetchImpl, `https://api.smartrecruiters.com/v1/companies/${board}/postings/${item.id}`);
    if (detail.failure) return { jobs, failures: [{ source: `smartrecruiters:${board}`, reason: detail.failure }] };
    const job = smartRecruitersJob(board, detail.body);
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

export function ashbyJob(board: string, value: unknown): RawDiscoveredVacancy | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = text(row.title);
  const url = text(row.jobUrl);
  const description = text(row.descriptionHtml);
  if (!title || !url || !description) return null;
  const location = row.location && typeof row.location === "object" ? text((row.location as { name?: unknown }).name) : "";
  return {
    source: "ashby",
    sourceUrl: url,
    applicationUrl: url,
    externalId: text(row.id) || null,
    companyName: board,
    title,
    location: location || null,
    employmentType: text(row.employmentType) || null,
    description,
    originalDescription: description,
    postedAt: text(row.publishedAt) || null,
  };
}

export function workableJob(board: string, value: unknown): RawDiscoveredVacancy | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = text(row.title);
  const code = text(row.shortcode);
  const url = `https://apply.workable.com/${board}/j/${code}`;
  const description = text(row.description);
  if (!title || !code || !description) return null;
  const location = row.location && typeof row.location === "object" ? text((row.location as { city?: unknown; country?: unknown }).city) : "";
  return {
    source: "workable",
    sourceUrl: url,
    applicationUrl: url,
    externalId: code || null,
    companyName: board,
    title,
    location: location || null,
    employmentType: text(row.type) || null,
    description,
    originalDescription: description,
    postedAt: text(row.published_on) || null,
  };
}

export function smartRecruitersJob(board: string, value: unknown): RawDiscoveredVacancy | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = text(row.name);
  const url = text((row.ref ?? {}) as Record<string, unknown>).replace("api.", "www.").replace("/v1/companies", "") || `https://jobs.smartrecruiters.com/${board}/${row.id}`;
  const jobAd = row.jobAd && typeof row.jobAd === "object" ? row.jobAd as Record<string, unknown> : {};
  const sections = jobAd.sections && typeof jobAd.sections === "object" ? jobAd.sections as Record<string, unknown> : {};
  const description = [text(sections.companyDescription), text(sections.jobDescription), text(sections.qualifications), text(sections.additionalInformation)].filter(Boolean).join("\n\n");
  if (!title || !description) return null;
  const location = row.location && typeof row.location === "object" ? text((row.location as { city?: unknown }).city) : "";
  return {
    source: "smartrecruiters",
    sourceUrl: url,
    applicationUrl: url,
    externalId: text(row.id) || null,
    companyName: board,
    title,
    location: location || null,
    employmentType: text((row.typeOfEmployment ?? {}) as Record<string, unknown>) || null,
    description,
    originalDescription: description,
    postedAt: text(row.releasedDate) || null,
  };
}

async function searxngVacancies(query: string, limit: number, fetchImpl: typeof fetch = fetch): Promise<SourceCollection> {
  try {
    const atsDomains = ["boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com", "apply.workable.com", "jobs.smartrecruiters.com"];
    const jobs: RawDiscoveredVacancy[] = [];
    const failures: SourceFailure[] = [];

    const perDomain = Math.ceil(limit / atsDomains.length);

    for (const domain of atsDomains) {
      if (jobs.length >= limit) break;
      const payload = await searxngSearch({ query: `${query} site:${domain}`, limit: perDomain, language: "en" });
      const hits = parseSearxngResults(payload, query, limit);

      for (const hit of hits) {
        if (jobs.length >= limit) break;
        const resolved = await resolveAtsUrl(fetchImpl, hit.url);
        if (resolved.job) {
          jobs.push(resolved.job);
        } else if (resolved.failure) {
          failures.push(resolved.failure);
        }
        await delay(200);
      }
    }
    
    return { jobs, failures };
  } catch (error) {
    return { jobs: [], failures: [{ source: "searxng", reason: error instanceof Error ? error.message : "unavailable" }] };
  }
}

export async function resolveAtsUrl(fetchImpl: typeof fetch, url: string): Promise<{ job: RawDiscoveredVacancy | null; failure: SourceFailure | null }> {
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();
    const path = parsedUrl.pathname.split('/').filter(Boolean);

    if (host.includes('greenhouse.io')) {
      if (path.length >= 3 && path[1] === 'jobs') {
        const board = path[0];
        const id = path[2];
        const detail = await readJson(fetchImpl, `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`);
        if (detail.failure) return { job: null, failure: { source: "searxng:greenhouse", reason: detail.failure } };
        const job = greenhouseJob(detail.body);
        if (job) return { job, failure: null };
        return { job: null, failure: { source: "searxng:greenhouse", reason: "PARSE_FAILED" } };
      }
      return { job: null, failure: { source: "searxng:greenhouse", reason: "NOT_INDIVIDUAL_VACANCY" } };
    }

    if (host.includes('lever.co')) {
      if (path.length >= 2) {
        const board = path[0];
        const id = path[path.length - 1]; // Can be /company/job-id
        const detail = await readJson(fetchImpl, `https://api.lever.co/v0/postings/${board}/${id}?mode=json`);
        if (detail.failure) return { job: null, failure: { source: "searxng:lever", reason: detail.failure } };
        const job = leverJob(board, detail.body);
        if (job) return { job, failure: null };
        return { job: null, failure: { source: "searxng:lever", reason: "PARSE_FAILED" } };
      }
      return { job: null, failure: { source: "searxng:lever", reason: "NOT_INDIVIDUAL_VACANCY" } };
    }

    if (host.includes('ashbyhq.com')) {
      if (path.length >= 2) {
        const board = path[0];
        const id = path[path.length - 1];
        const list = await readJson(fetchImpl, `https://api.ashbyhq.com/posting-api/job-board/${board}`);
        if (list.failure) return { job: null, failure: { source: "searxng:ashby", reason: list.failure } };
        const rows = Array.isArray((list.body as { jobs?: unknown }).jobs) ? (list.body as { jobs: unknown[] }).jobs : [];
        const row = rows.find(r => typeof r === 'object' && r !== null && (r as { id?: string }).id === id);
        if (!row) return { job: null, failure: { source: "searxng:ashby", reason: "PARSE_FAILED" } };
        const job = ashbyJob(board, row);
        if (job) return { job, failure: null };
        return { job: null, failure: { source: "searxng:ashby", reason: "PARSE_FAILED" } };
      }
      return { job: null, failure: { source: "searxng:ashby", reason: "NOT_INDIVIDUAL_VACANCY" } };
    }

    if (host.includes('workable.com')) {
      if (path.length >= 3 && path[path.length - 2] === 'j') {
        const board = path[0];
        const id = path[path.length - 1];
        const detail = await readJson(fetchImpl, `https://apply.workable.com/api/v3/accounts/${board}/jobs/${id}`);
        if (detail.failure) return { job: null, failure: { source: "searxng:workable", reason: detail.failure } };
        const job = workableJob(board, detail.body);
        if (job) return { job, failure: null };
        return { job: null, failure: { source: "searxng:workable", reason: "PARSE_FAILED" } };
      }
      return { job: null, failure: { source: "searxng:workable", reason: "NOT_INDIVIDUAL_VACANCY" } };
    }

    if (host.includes('smartrecruiters.com')) {
      if (path.length >= 2) {
        const board = path[0];
        const id = path[path.length - 1];
        const detail = await readJson(fetchImpl, `https://api.smartrecruiters.com/v1/companies/${board}/postings/${id}`);
        if (detail.failure) return { job: null, failure: { source: "searxng:smartrecruiters", reason: detail.failure } };
        const job = smartRecruitersJob(board, detail.body);
        if (job) return { job, failure: null };
        return { job: null, failure: { source: "searxng:smartrecruiters", reason: "PARSE_FAILED" } };
      }
      return { job: null, failure: { source: "searxng:smartrecruiters", reason: "NOT_INDIVIDUAL_VACANCY" } };
    }

    return { job: null, failure: { source: "searxng", reason: "UNSUPPORTED_SOURCE" } };
  } catch {
    return { job: null, failure: { source: "searxng", reason: "INVALID_JOB_URL" } };
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
