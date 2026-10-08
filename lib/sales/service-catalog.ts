export const SERVICE_CATALOGUE = [
  { name: "Lead management and routing", group: "software", fit: "High enquiry volume, multiple offices, inconsistent ownership or follow-up." },
  { name: "Business process and workflow automation", group: "software", fit: "Repeated manual work, disconnected tools, or handoffs." },
  { name: "Custom web application or internal system", group: "software", fit: "A documented workflow cannot be handled well by available tools." },
  { name: "CRM and lifecycle automation", group: "software", fit: "Customer records, pipeline stages, or follow-up need structure." },
  { name: "Customer portal or self-service platform", group: "software", fit: "Customers repeatedly need status, documents, bookings, or account actions." },
  { name: "API and SaaS integrations", group: "software", fit: "Public evidence shows disconnected systems or duplicate data entry." },
  { name: "AI-enabled business workflow", group: "software", fit: "A specific repeatable knowledge task can be assisted with AI and human review." },
  { name: "Booking or enquiry conversion system", group: "software", fit: "Customers express intent but the observed digital path adds friction." },
  { name: "Website conversion optimization", group: "digital", fit: "Observed landing pages or calls to action leave a clear conversion gap." },
  { name: "Website design and development", group: "digital", fit: "The public site has a concrete usability, mobile, or functionality issue." },
  { name: "Analytics and conversion tracking", group: "digital", fit: "A measurable acquisition path lacks observable measurement signals." },
  { name: "Google Ads and paid search", group: "marketing", fit: "Search demand and a relevant offer support a focused paid acquisition test." },
  { name: "Meta advertising and lead generation", group: "marketing", fit: "A visual consumer offer and a workable landing path support a test." },
  { name: "Performance marketing and funnel optimization", group: "marketing", fit: "An existing acquisition funnel has a specific observable weak point." },
  { name: "Remarketing and customer lifecycle marketing", group: "marketing", fit: "An observed audience or customer journey supports a relevant follow-up path." },
] as const;

export function serviceCataloguePrompt() {
  return SERVICE_CATALOGUE.map((item) => `- ${item.name}: ${item.fit}`).join("\n");
}
