import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { queueJob, recordActivity } from "@/lib/jobs";
import { fetchPublic } from "@/lib/network";
import { routePublicBrowserTraffic } from "@/lib/research/public-browser";
import { httpStatusFromError, pageAccessBlocked, shouldUsePlaywright } from "@/lib/research/browser-decision";
import { extractPage, type PageSignals } from "@/lib/research/extract";
import { crawlCompanySite, crawlHasEvidence } from "@/lib/research/crawl";
import { socialLinks } from "@/lib/domains";
import { logInfo } from "@/lib/logger";
import { QUOTA_LEASE_MS } from "@/lib/campaign-quota";
import { watchLease } from "@/lib/independent-heartbeat";

export async function processResearch(prospectId: string) {
  const prospect = await prisma.prospect.findUnique({ where: { id: prospectId }, include: { campaign: true } });
  if (!prospect) throw new AppError("Prospect was not found.");
  if (!prospect.website) {
    await prisma.prospect.update({ where: { id: prospect.id }, data: { researchStatus: "SKIPPED" } });
    throw new AppError("This prospect has no public website to research.");
  }
  const slot = await reserveResearchSlot({
    id: prospect.id,
    website: prospect.website,
    campaignId: prospect.campaignId,
    campaign: prospect.campaign,
  });
  let kept = false;
  const stopLease = watchLease({ kind: "research", id: slot.id }, () => refreshResearchLease(slot.id));
  try {
  await prisma.prospect.update({ where: { id: prospect.id }, data: { researchStatus: "IN_PROGRESS" } });
  logInfo("research.started", { prospectId: prospect.id, domain: prospect.domain });
  const crawl = prospect.domain
    ? await crawlCompanySite({
        website: prospect.website,
        domain: prospect.domain,
        maxPages: prospect.campaign?.maxPagesPerSite ?? 10,
        maxDepth: prospect.campaign?.crawlDepth ?? 2,
      })
    : null;
  if (crawl && crawlHasEvidence(crawl)) {
    const page = crawl.pages.find((item) => (item.text ?? "").length >= 280) ?? crawl.pages[0];
    await prisma.researchRecord.update({
      where: { id: slot.id },
      data: {
        url: page?.url ?? prospect.website,
        fetchMethod: "scrapy",
        title: page?.title || crawl.companyName || null,
        metaDescription: crawl.description || null,
        excerpt: (page?.text ?? "").slice(0, 5000),
        headings: [],
        signals: {
          services: crawl.services,
          technology: crawl.technologySignals,
          advertising: crawl.advertisingSignals,
          emails: crawl.emails.map((item) => item.value),
          phones: crawl.phones.map((item) => item.value),
          socialUrls: crawl.socialProfiles.map((item) => item.url),
        },
        sourceType: "website",
        content: (page?.text ?? "").slice(0, 5000),
        technologies: crawl.technologySignals,
        services: crawl.services,
        contactSignals: { emails: crawl.emails, phones: crawl.phones },
        advertisingSignals: { observed: crawl.advertisingSignals },
        softwareSignals: { observedTechnology: crawl.technologySignals },
        socialLinks: crawl.socialProfiles,
        trackingSignals: { observed: crawl.advertisingSignals },
        confidence: 70,
      },
    });
    kept = true;
    await storeObservedContacts(prospect.organizationId, prospect.id, page?.url ?? prospect.website, {
      services: crawl.services,
      technology: crawl.technologySignals,
      advertising: crawl.advertisingSignals,
      callsToAction: [],
      forms: 0,
      emails: crawl.emails.map((item) => item.value),
      phones: crawl.phones.map((item) => item.value),
      socialUrls: crawl.socialProfiles.map((item) => item.url),
    });
    await finishResearch(prospect, "scrapy", page?.url ?? prospect.website, crawl.description, crawl.phones[0]?.value, crawl.socialProfiles.map((item) => item.url));
    return;
  }
  let html = "";
  let finalUrl = prospect.website;
  let httpStatus = 0;
  try {
    const first = await fetchPublicHtml(prospect.website);
    html = first.html;
    finalUrl = first.url;
  } catch (error) {
    httpStatus = httpStatusFromError(error);
    logInfo("research.http.failed", { prospectId: prospect.id, status: httpStatus });
    if (httpStatus !== 401 && httpStatus !== 403) throw error;
  }
  const initial = html ? extractPage(html, finalUrl) : { excerpt: "", signals: emptySignals(), title: null, metaDescription: null, headings: [] as string[] };
  let method = httpStatus ? "http-blocked" : "http";
  let playwrightTried = false;
  if (shouldUsePlaywright({ httpStatus, excerpt: initial.excerpt, html, scrapySufficient: false })) {
    playwrightTried = true;
    logInfo("research.playwright.started", { prospectId: prospect.id, status: httpStatus });
    try {
      const rendered = await renderWithPlaywright(finalUrl);
      if (pageAccessBlocked({ html: rendered })) {
        logInfo("research.playwright.blocked", { prospectId: prospect.id });
      } else {
        html = rendered;
        method = "playwright";
        logInfo("research.playwright.completed", { prospectId: prospect.id });
      }
    } catch (error) {
      logInfo("research.playwright.failed", { prospectId: prospect.id, message: error instanceof Error ? error.message : "failed" });
    }
  }
  if (method !== "playwright" && (!html || pageAccessBlocked({ status: httpStatus, html }))) {
    await prisma.researchRecord.update({
      where: { id: slot.id },
      data: {
        url: finalUrl,
        fetchMethod: "blocked",
        excerpt: "",
        headings: [],
        signals: { status: httpStatus, note: "The site refused automated access. No page text was stored." },
        sourceType: "blocked",
        confidence: 0,
      },
    });
    kept = true;
    await prisma.prospect.update({ where: { id: prospect.id }, data: { researchStatus: "FAILED" } });
    await recordActivity({
      organizationId: prospect.organizationId,
      campaignId: prospect.campaignId,
      prospectId: prospect.id,
      action: "research.blocked",
      detail: httpStatus ? `HTTP ${httpStatus}` : playwrightTried ? "Playwright could not read the page" : "The HTTP response was an access challenge",
    });
    return;
  }
  const extracted = extractPage(html, finalUrl);
  await prisma.researchRecord.update({
    where: { id: slot.id },
    data: {
      url: finalUrl,
      fetchMethod: method,
      title: extracted.title,
      metaDescription: extracted.metaDescription,
      excerpt: extracted.excerpt,
      headings: extracted.headings,
      signals: extracted.signals,
      sourceType: "website",
      content: extracted.excerpt,
      technologies: extracted.signals.technology,
      services: extracted.signals.services,
      contactSignals: { emails: extracted.signals.emails, phones: extracted.signals.phones },
      advertisingSignals: { observed: extracted.signals.advertising },
      softwareSignals: { observedTechnology: extracted.signals.technology },
      socialLinks: extracted.signals.socialUrls,
      bookingSignals: { forms: extracted.signals.forms, callsToAction: extracted.signals.callsToAction },
      trackingSignals: { observed: extracted.signals.technology.filter((item) => /analytics|pixel|tag manager/i.test(item)) },
      confidence: extracted.excerpt.length > 280 ? 70 : 40,
    },
  });
  kept = true;
  await storeObservedContacts(prospect.organizationId, prospect.id, finalUrl, extracted.signals);
  await finishResearch(prospect, method, finalUrl, extracted.metaDescription, extracted.signals.phones[0], extracted.signals.socialUrls);
  } finally {
    stopLease();
    if (!kept) await releaseResearchSlot(slot.id);
  }
}

async function finishResearch(
  prospect: { id: string; organizationId: string; campaignId: string | null; description: string | null; phone: string | null; linkedinUrl: string | null; facebookUrl: string | null; instagramUrl: string | null },
  method: string,
  finalUrl: string,
  description: string | null,
  phone: string | undefined,
  urls: string[],
) {
  const social = socialLinks(urls);
  await prisma.prospect.update({
    where: { id: prospect.id },
    data: {
      researchStatus: "COMPLETED",
      description: prospect.description || description,
      phone: prospect.phone || phone || null,
      linkedinUrl: prospect.linkedinUrl || social.linkedinUrl,
      facebookUrl: prospect.facebookUrl || social.facebookUrl,
      instagramUrl: prospect.instagramUrl || social.instagramUrl,
    },
  });
  await recordActivity({
    organizationId: prospect.organizationId,
    campaignId: prospect.campaignId,
    prospectId: prospect.id,
    action: "prospect.researched",
    detail: `${method} ${finalUrl}`,
  });
  await queueJob({
    organizationId: prospect.organizationId,
    campaignId: prospect.campaignId,
    prospectId: prospect.id,
    queue: "qualification",
    name: "qualification.analyze",
    payload: { provider: method },
  });
}

async function fetchPublicHtml(input: string): Promise<{ url: string; html: string }> {
  const response = await fetchPublic(input);
  if (response.status < 200 || response.status >= 300) throw new AppError(`The website returned status ${response.status}.`);
  const type = response.headers["content-type"] ?? "";
  if (!type.includes("text/html") && !type.includes("text/plain") && type) {
    throw new AppError("The website did not return an HTML page.");
  }
  return { url: response.url, html: response.body.toString("utf8") };
}

async function renderWithPlaywright(url: string) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    await routePublicBrowserTraffic(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function reserveResearchSlot(prospect: {
  id: string;
  website: string;
  campaignId: string | null;
  campaign: { dailyResearchLimit: number } | null;
}) {
  return prisma.$transaction(async (tx) => {
    if (prospect.campaign && prospect.campaignId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`research:${prospect.campaignId}`}))`;
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      const staleBefore = new Date(Date.now() - QUOTA_LEASE_MS);
      await tx.researchRecord.deleteMany({
        where: { prospect: { campaignId: prospect.campaignId }, fetchMethod: "pending", createdAt: { lt: staleBefore } },
      });
      const researched = await tx.researchRecord.count({
        where: { prospect: { campaignId: prospect.campaignId }, createdAt: { gte: start } },
      });
      if (researched >= prospect.campaign.dailyResearchLimit) {
        throw new AppError("The daily research limit has been reached.");
      }
    }
    return tx.researchRecord.create({
      data: {
        prospectId: prospect.id,
        url: prospect.website,
        fetchMethod: "pending",
        excerpt: "",
        headings: [],
        signals: { note: "Research slot reserved." },
        sourceType: "website",
        confidence: 0,
      },
    });
  });
}

async function refreshResearchLease(id: string) {
  await prisma.researchRecord.updateMany({
    where: { id, fetchMethod: "pending" },
    data: { createdAt: new Date() },
  });
}

async function releaseResearchSlot(id: string) {
  await prisma.researchRecord.deleteMany({ where: { id, fetchMethod: "pending" } });
}

function emptySignals(): PageSignals {
  return { services: [], technology: [], advertising: [], callsToAction: [], forms: 0, emails: [], phones: [], socialUrls: [] };
}

async function storeObservedContacts(organizationId: string, prospectId: string, sourceUrl: string, signals: PageSignals) {
  const generic = /^(info|hello|contact|sales|admin|support|office|enquiries|inquiries)@/i;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prospectId}))`;
    for (const [index, email] of signals.emails.entries()) {
      const existing = await tx.contact.findFirst({ where: { prospectId, email } });
      if (existing) continue;
      const primary = await tx.contact.findFirst({ where: { prospectId, isPrimary: true }, select: { id: true } });
      await tx.contact.create({
        data: {
          organizationId,
          prospectId,
          email,
          source: "website",
          sourceUrl,
          confidence: generic.test(email) ? 45 : 30,
          isPrimary: index === 0 && !primary,
        },
      });
    }
  });
}
