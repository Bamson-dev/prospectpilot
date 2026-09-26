import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { queueJob, recordActivity } from "@/lib/jobs";
import { assertResolvedPublicUrl } from "@/lib/network";
import { extractPage, pageLooksThin, type PageSignals } from "@/lib/research/extract";
import { socialLinks } from "@/lib/domains";

const MAX_REDIRECTS = 3;

export async function processResearch(prospectId: string) {
  const prospect = await prisma.prospect.findUnique({ where: { id: prospectId }, include: { campaign: true } });
  if (!prospect) throw new AppError("Prospect was not found.");
  if (!prospect.website) {
    await prisma.prospect.update({ where: { id: prospect.id }, data: { researchStatus: "SKIPPED" } });
    throw new AppError("This prospect has no public website to research.");
  }
  if (prospect.campaign) {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const researched = await prisma.researchRecord.count({
      where: { prospect: { campaignId: prospect.campaignId }, createdAt: { gte: start } },
    });
    if (researched >= prospect.campaign.dailyResearchLimit) {
      throw new AppError("The daily research limit has been reached.");
    }
  }
  await prisma.prospect.update({ where: { id: prospect.id }, data: { researchStatus: "IN_PROGRESS" } });
  const first = await fetchPublicHtml(prospect.website);
  let html = first.html;
  const finalUrl = first.url;
  let method = "http";
  const initial = extractPage(html, finalUrl);
  if (pageLooksThin(initial.excerpt)) {
    const rendered = await renderWithPlaywright(finalUrl);
    html = rendered;
    method = "playwright";
  }
  const extracted = extractPage(html, finalUrl);
  const social = socialLinks(extracted.signals.socialUrls);
  await prisma.researchRecord.create({
    data: {
      prospectId: prospect.id,
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
  await storeObservedContacts(prospect.organizationId, prospect.id, finalUrl, extracted.signals);
  await prisma.prospect.update({
    where: { id: prospect.id },
    data: {
      researchStatus: "COMPLETED",
      description: prospect.description || extracted.metaDescription,
      phone: prospect.phone || extracted.signals.phones[0] || null,
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
  });
}

async function fetchPublicHtml(input: string, hops = 0): Promise<{ url: string; html: string }> {
  if (hops > MAX_REDIRECTS) throw new AppError("The website redirected too many times.");
  const url = await assertResolvedPublicUrl(input);
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(12000),
    headers: { "User-Agent": "ProspectPilotResearch/0.1", Accept: "text/html" },
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new AppError("The website redirected without a destination.");
    return fetchPublicHtml(new URL(location, url).toString(), hops + 1);
  }
  if (!response.ok) throw new AppError(`The website returned status ${response.status}.`);
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/html") && !type.includes("text/plain") && type) {
    throw new AppError("The website did not return an HTML page.");
  }
  return { url: url.toString(), html: await response.text() };
}

async function renderWithPlaywright(url: string) {
  await assertResolvedPublicUrl(url);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function storeObservedContacts(organizationId: string, prospectId: string, sourceUrl: string, signals: PageSignals) {
  const generic = /^(info|hello|contact|sales|admin|support|office|enquiries|inquiries)@/i;
  for (const [index, email] of signals.emails.entries()) {
    const existing = await prisma.contact.findFirst({ where: { prospectId, email } });
    if (existing) continue;
    await prisma.contact.create({
      data: {
        organizationId,
        prospectId,
        email,
        source: "website",
        sourceUrl,
        confidence: generic.test(email) ? 45 : 30,
        isPrimary: index === 0,
      },
    });
  }
}
