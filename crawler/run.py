#!/usr/bin/env python3
"""Focused public-site crawler. Reads a JSON job and writes a JSON result."""

import json
import re
import sys
from urllib.parse import urljoin, urlparse

import scrapy
from scrapy.crawler import CrawlerProcess

EMAIL = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
PHONE = re.compile(r"(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]\d{3,4}")
INTEREST = ("about", "service", "product", "solution", "contact", "team", "pricing", "case", "portfolio", "blog", "career")
RESULT = {
    "domain": "",
    "pages": [],
    "emails": [],
    "phones": [],
    "socialProfiles": [],
    "companyName": "",
    "description": "",
    "services": [],
    "technologySignals": [],
    "advertisingSignals": [],
    "contactPages": [],
    "teamPages": [],
}


class CompanySpider(scrapy.Spider):
    name = "company"
    custom_settings = {
        "ROBOTSTXT_OBEY": True,
        "AUTOTHROTTLE_ENABLED": True,
        "AUTOTHROTTLE_START_DELAY": 1,
        "AUTOTHROTTLE_MAX_DELAY": 8,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 2,
        "DOWNLOAD_TIMEOUT": 12,
        "RETRY_TIMES": 1,
        "LOG_ENABLED": False,
        "TELNETCONSOLE_ENABLED": False,
        "COOKIES_ENABLED": False,
        "REDIRECT_MAX_TIMES": 3,
    }

    def __init__(self, start_url, allowed, max_pages, max_depth, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_urls = [start_url]
        self.allowed_domains = [allowed]
        self.max_pages = max_pages
        self.max_depth = max_depth

    def parse(self, response, depth=0):
        if len(RESULT["pages"]) >= self.max_pages:
            return
        if response.status >= 400 or len(response.body) > 1_500_000:
            return
        text = " ".join(part.strip() for part in response.xpath("//body//text()[not(ancestor::script)][not(ancestor::style)]").getall())
        text = re.sub(r"\s+", " ", text)[:4000]
        title = (response.css("title::text").get() or "").strip()[:200]
        RESULT["pages"].append({"url": response.url, "title": title, "text": text})
        if not RESULT["companyName"] and title:
            RESULT["companyName"] = title[:160]
        if not RESULT["description"]:
            description = response.css('meta[name="description"]::attr(content)').get() or ""
            RESULT["description"] = description.strip()[:500]
        for email in EMAIL.findall(response.text):
            lowered = email.lower()
            if lowered.endswith((".png", ".jpg", ".jpeg", ".gif", ".svg", ".css", ".js")):
                continue
            add_unique(RESULT["emails"], {"value": lowered, "sourceUrl": response.url})
        for phone in PHONE.findall(text):
            add_unique(RESULT["phones"], {"value": phone.strip(), "sourceUrl": response.url})
        html = response.text.lower()
        for label, needle in (
            ("meta-pixel", "fbevents.js"),
            ("google-tag", "googletagmanager.com"),
            ("google-analytics", "google-analytics.com"),
            ("analytics", "gtag("),
        ):
            if needle in html:
                add_text(RESULT["advertisingSignals"], label)
        for label, needle in (("wordpress", "wp-content"), ("shopify", "cdn.shopify.com"), ("wix", "wixstatic.com")):
            if needle in html:
                add_text(RESULT["technologySignals"], label)
        path = urlparse(response.url).path.lower()
        if "contact" in path:
            add_text(RESULT["contactPages"], response.url)
        if "team" in path or "about" in path:
            add_text(RESULT["teamPages"], response.url)
        if depth >= self.max_depth:
            return
        for href in response.css("a::attr(href)").getall():
            absolute = urljoin(response.url, href)
            parsed = urlparse(absolute)
            if parsed.scheme not in ("http", "https"):
                continue
            if parsed.netloc.lower().removeprefix("www.") != self.allowed_domains[0]:
                if any(host in parsed.netloc for host in ("linkedin.com", "facebook.com", "instagram.com")):
                    add_unique(RESULT["socialProfiles"], {"url": absolute, "sourceUrl": response.url})
                continue
            if any(token in parsed.path.lower() for token in INTEREST):
                yield response.follow(absolute, callback=self.parse, cb_kwargs={"depth": depth + 1})


def add_unique(bucket, item):
    if item not in bucket and len(bucket) < 30:
        bucket.append(item)


def add_text(bucket, value):
    if value not in bucket and len(bucket) < 20:
        bucket.append(value)


def main():
    job = json.loads(open(sys.argv[1], encoding="utf-8").read())
    out_path = sys.argv[2]
    domain = job["domain"].lower().removeprefix("www.")
    RESULT["domain"] = domain
    process = CrawlerProcess(settings={"USER_AGENT": "ProspectPilotResearch/1.0 (+https://leadpilot.live)", "CLOSESPIDER_PAGECOUNT": int(job["maxPages"])})
    process.crawl(CompanySpider, start_url=job["website"], allowed=domain, max_pages=int(job["maxPages"]), max_depth=int(job["maxDepth"]))
    process.start()
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(RESULT, handle)


if __name__ == "__main__":
    main()
