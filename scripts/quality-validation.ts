import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { scoreJobFit } from "../lib/applications/fit";
import { buildCvDraft } from "../lib/applications/cv";
import { buildCoverLetter } from "../lib/applications/cover-letter";
import { answerQuestion } from "../lib/applications/questions";
import { ensureCandidate } from "../lib/applications/service";
import { completeJson } from "../lib/ai/client";
import { CV_SYSTEM_PROMPT, evidencePrompt } from "../lib/applications/prompts";

const prisma = new PrismaClient();

async function run() {
  // Setup Org in Test DB
  const org = await prisma.organization.upsert({
    where: { id: "test-org" },
    update: {},
    create: { id: "test-org", name: "Test Org", slug: "test-org" }
  });

  const candRow = await ensureCandidate(org.id);
  const candidateId = candRow.id;

  // Update basic candidate details
  await prisma.candidate.update({
    where: { id: candidateId },
    data: {
      fullName: "Bamidele Matthew",
      firstName: "Bamidele",
      lastName: "Matthew",
      email: "Bamzonline01@gmail.com",
      phone: "+2340000000000",
      location: "Lagos, Nigeria",
      linkedinUrl: "https://linkedin.com/in/bamz",
      workAuthorization: "Authorized to work",
      sponsorship: "Do not require sponsorship"
    }
  });

  // Clear existing evidence
  await prisma.candidateExperience.deleteMany({ where: { candidateId } });
  await prisma.candidateProject.deleteMany({ where: { candidateId } });
  await prisma.candidateFact.deleteMany({ where: { candidateId } });
  await prisma.candidateEducation.deleteMany({ where: { candidateId } });

  // 1. Experiences
  const experiences = [
    { title: "Founder & Chief Marketing Officer", organizationName: "PromptEarn", summary: "growth marketing, performance marketing, GTM strategy, digital operations, affiliate growth, CRM workflows, marketing automation, 100,000+ affiliates within first year, 100,000+ users under 12 months, $1.5m cumulative platform revenue", profiles: ["MARKETING", "GROWTH", "FOUNDER", "HYBRID"] },
    { title: "Marketing Director", organizationName: "Globalwave Softech", summary: "SaaS marketing, growth strategy, performance campaigns, 10,000 -> 65,000 active users, 20% churn reduction, B2B demand generation, account-based marketing", profiles: ["MARKETING", "GROWTH", "SAAS", "HYBRID"] },
    { title: "Head of Marketing", organizationName: "Silverline E-commerce", summary: "end-to-end marketing, ₦15M -> ₦120M monthly revenue, performance marketing, affiliate programs, influencer partnerships, 35% increase in repeat customer rate, 7-figure monthly affiliate/influencer sales", profiles: ["MARKETING", "GROWTH", "WEB", "HYBRID"] },
    { title: "Growth Marketing Specialist", organizationName: "Zenith Technologies", summary: "B2B/B2C GTM, 30% product adoption increase, 25% acquisition cost reduction, automation, CRO, channel optimization, sales/marketing alignment", profiles: ["MARKETING", "GROWTH", "SAAS", "HYBRID"] },
    { title: "Digital Marketing Executive", organizationName: "Interswitch Group", summary: "fintech marketing, 20% product uptake increase, 45% digital engagement increase", profiles: ["MARKETING", "GROWTH", "HYBRID"] },
    { title: "Marketing Associate", organizationName: "Aramco", summary: "corporate/regional digital marketing, West Africa, digital-first marketing, 30% regional brand visibility increase, 1M+ audience reach", profiles: ["MARKETING", "GROWTH", "HYBRID"] },
    { title: "Junior Digital Marketer", organizationName: "Swift Digital Solutions", summary: "social media, paid advertising, website optimization, 20% traffic increase, campaign reporting", profiles: ["MARKETING"] },
    { title: "Digital Marketing Intern", organizationName: "New Horizons", summary: "SEO, social media, digital advertising, SME marketing, analytics, client training", profiles: ["MARKETING"] }
  ];

  for (const exp of experiences) {
    await prisma.candidateExperience.create({
      data: { candidateId, title: exp.title, organizationName: exp.organizationName, summary: exp.summary, profiles: exp.profiles as any, verified: true, source: "CV", current: false }
    });
  }

  // 2. Projects
  const projects = [
    { name: "LeadThur", role: "Software Developer", description: "B2B contact discovery platform with custom search, subscriber dashboard, subscription billing, Paystack integration, SaaS functionality, B2B functionality.", technologies: ["SaaS", "B2B", "Paystack", "TypeScript"], features: ["Custom search", "Subscriber dashboard", "Subscription billing"], outcomes: ["Generated ₦15M+ in its first three months"], profiles: ["SOFTWARE", "WEB", "SAAS", "HYBRID"] },
    { name: "DigitalSkillX", role: "Software Developer", description: "Custom LMS with course management, student progress tracking, certificates, NGN payments, USD payments, admin backend, instructor backend.", technologies: ["LMS", "Payment Gateways", "Backend"], features: ["Course management", "Progress tracking", "Certificates", "Payments"], outcomes: [], profiles: ["SOFTWARE", "WEB", "HYBRID"] },
    { name: "Adley", role: "Software Developer", description: "AI media buyer Telegram bot with Telegram interface, Meta advertising analysis, CSV/XLSX report processing, report analysis, persistent context.", technologies: ["Telegram Bot", "Meta Ads API", "AI", "CSV/XLSX processing"], features: ["Telegram interface", "Advertising analysis", "Report processing"], outcomes: ["5,000+ active users"], profiles: ["SOFTWARE", "WEB", "HYBRID"] },
    { name: "E-commerce Platform", role: "Software Developer", description: "Documented client project containing storefront, order management, customer management, inventory, payment processing, analytics, campaign management, coupon management, built-in CRM.", technologies: ["E-commerce", "CRM", "Payment Processing"], features: ["Storefront", "Order management", "Inventory", "Analytics"], outcomes: [], profiles: ["SOFTWARE", "WEB", "SAAS", "HYBRID"] },
    { name: "Crypto Investment Platform", role: "Software Developer", description: "Documented client project containing Nigerian-market crypto platform, NGN, BTC, ETH, USDT, USDC, investor application, portfolio management, wallet, KYC, buy/sell functionality, admin system, compliance, risk management, audit modules, PostgreSQL ledger.", technologies: ["Crypto", "PostgreSQL", "KYC", "Wallet Integration"], features: ["Portfolio management", "Buy/sell functionality", "Admin system", "Compliance"], outcomes: [], profiles: ["SOFTWARE", "WEB", "HYBRID"] },
    { name: "AI Chat Application", role: "Software Developer", description: "Documented application containing AI chat, conversation history, image upload, markdown, light/dark mode, Naija Mode, WhatsApp Reply Generator, content generator, prompt library, export functionality.", technologies: ["AI", "Markdown", "Image processing"], features: ["Conversation history", "Image upload", "Prompt library", "Export"], outcomes: [], profiles: ["SOFTWARE", "WEB", "HYBRID"] }
  ];

  for (const proj of projects) {
    await prisma.candidateProject.create({
      data: { candidateId, name: proj.name, role: proj.role, description: proj.description, technologies: proj.technologies, features: proj.features, outcomes: proj.outcomes, profiles: proj.profiles as any, verified: true, source: "CV" }
    });
  }

  // 3. Education
  await prisma.candidateEducation.create({
    data: { candidateId, institution: "National Open University of Nigeria (NOUN)", degree: "Bachelor of Science (B.Sc.)", source: "CV" }
  });

  const fullCandidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: { facts: true, experiences: true, projects: true }
  });
  
  if (!fullCandidate) return;

  const testJobs = [
    {
      id: "TEST1",
      title: "Full-Stack Software Engineer",
      companyName: "TechNova SaaS",
      description: "We need a strong Full-Stack Developer to build out our SaaS platform. You will develop REST APIs, manage PostgreSQL databases, and build interactive UIs using Next.js/React. Requires solid software engineering fundamentals, debugging skills, and ability to work independently on deployment and git workflows.",
      requirements: [
        { text: "JavaScript", kind: "MUST_HAVE", certainty: "required" },
        { text: "TypeScript", kind: "MUST_HAVE", certainty: "required" },
        { text: "React", kind: "MUST_HAVE", certainty: "required" },
        { text: "Next.js", kind: "MUST_HAVE", certainty: "required" },
        { text: "Node.js", kind: "MUST_HAVE", certainty: "required" },
        { text: "REST APIs", kind: "MUST_HAVE", certainty: "required" },
        { text: "PostgreSQL", kind: "MUST_HAVE", certainty: "required" },
        { text: "SaaS/product development", kind: "MUST_HAVE", certainty: "required" },
      ],
      questions: [
        "Tell us about your experience with TypeScript.",
        "Why do you want to work at TechNova SaaS?"
      ]
    },
    {
      id: "TEST2",
      title: "Growth Marketing Manager",
      companyName: "Acme E-Commerce",
      description: "We are looking for a Growth Marketing Manager to drive performance marketing and user acquisition. You will handle Meta Ads, Google Ads, funnel optimization, CRM, and lifecycle marketing for our e-commerce SaaS product. Measurable revenue growth is the ultimate goal.",
      requirements: [
        { text: "performance marketing", kind: "MUST_HAVE", certainty: "required" },
        { text: "Meta Ads", kind: "MUST_HAVE", certainty: "required" },
        { text: "growth strategy", kind: "MUST_HAVE", certainty: "required" },
        { text: "GTM", kind: "MUST_HAVE", certainty: "required" },
        { text: "CRM", kind: "MUST_HAVE", certainty: "required" },
        { text: "lifecycle marketing", kind: "MUST_HAVE", certainty: "required" },
        { text: "SaaS", kind: "MUST_HAVE", certainty: "required" },
        { text: "e-commerce", kind: "MUST_HAVE", certainty: "required" },
        { text: "measurable revenue growth", kind: "MUST_HAVE", certainty: "required" },
      ],
      questions: [
        "Tell us about your experience with CRM.",
        "Why do you want to work at Acme E-Commerce?"
      ]
    },
    {
      id: "TEST3",
      title: "Product Marketing Manager",
      companyName: "LaunchPad SaaS",
      description: "We are looking for a Product Marketing Manager to lead our GTM strategy. You will work closely with product and engineering to launch features, run performance marketing, and drive adoption for our B2B SaaS platform.",
      requirements: [
        { text: "GTM strategy", kind: "MUST_HAVE", certainty: "required" },
        { text: "product launches", kind: "MUST_HAVE", certainty: "required" },
        { text: "performance marketing", kind: "MUST_HAVE", certainty: "required" },
        { text: "SaaS", kind: "MUST_HAVE", certainty: "required" },
        { text: "B2B marketing", kind: "MUST_HAVE", certainty: "required" }
      ],
      questions: ["Why LaunchPad SaaS?"]
    },
    {
      id: "TEST4",
      title: "Technical Product Manager",
      companyName: "DataGrid Systems",
      description: "A Technical Product Manager to oversee our internal platforms. Must understand APIs, SaaS billing, growth strategies, and customer management (CRM). You will bridge engineering and marketing.",
      requirements: [
        { text: "SaaS platforms", kind: "MUST_HAVE", certainty: "required" },
        { text: "APIs", kind: "MUST_HAVE", certainty: "required" },
        { text: "billing systems", kind: "MUST_HAVE", certainty: "required" },
        { text: "growth", kind: "MUST_HAVE", certainty: "required" },
        { text: "CRM", kind: "MUST_HAVE", certainty: "required" }
      ],
      questions: ["What technical platforms have you built?"]
    },
    {
      id: "TEST5",
      title: "Marketing Technology Specialist",
      companyName: "MarTech Innovators",
      description: "Join us as a MarTech Specialist to build and optimize our marketing automation pipelines. Requires knowledge of CRM, data integrations, growth marketing, and automation.",
      requirements: [
        { text: "marketing technology", kind: "MUST_HAVE", certainty: "required" },
        { text: "automation", kind: "MUST_HAVE", certainty: "required" },
        { text: "growth marketing", kind: "MUST_HAVE", certainty: "required" },
        { text: "CRM", kind: "MUST_HAVE", certainty: "required" }
      ],
      questions: ["Tell us about your automation experience."]
    },
    {
      id: "TEST6",
      title: "Frontend Developer",
      companyName: "PixelPerfect Web",
      description: "We need a frontend developer specialized in React and Next.js to build intuitive user interfaces. Marketing experience is not required.",
      requirements: [
        { text: "Frontend development", kind: "MUST_HAVE", certainty: "required" },
        { text: "React", kind: "MUST_HAVE", certainty: "required" },
        { text: "Next.js", kind: "MUST_HAVE", certainty: "required" },
        { text: "TypeScript", kind: "MUST_HAVE", certainty: "required" }
      ],
      questions: ["Tell us about your React experience."]
    },
    {
      id: "TEST7",
      title: "Performance Marketing Manager",
      companyName: "Acme E-Commerce",
      description: "Focus purely on Meta Ads, Google Ads, and CPA optimization. B2C only.",
      requirements: [
        { text: "Performance marketing", kind: "MUST_HAVE", certainty: "required" },
        { text: "Meta Ads", kind: "MUST_HAVE", certainty: "required" },
        { text: "CPA reduction", kind: "MUST_HAVE", certainty: "required" }
      ],
      questions: ["Tell us about your Meta Ads experience."]
    },
    {
      id: "TEST8",
      title: "SaaS Growth Manager",
      companyName: "SaaS Innovators",
      description: "Drive adoption and retention for our B2B SaaS. Mix of lifecycle marketing, product marketing, and growth loops.",
      requirements: [
        { text: "SaaS", kind: "MUST_HAVE", certainty: "required" },
        { text: "B2B", kind: "MUST_HAVE", certainty: "required" },
        { text: "product adoption", kind: "MUST_HAVE", certainty: "required" },
        { text: "lifecycle marketing", kind: "MUST_HAVE", certainty: "required" }
      ],
      questions: ["Why SaaS Innovators?"]
    },
    {
      id: "TEST9",
      title: "Growth Marketing Manager",
      companyName: "Acme E-Commerce",
      description: "Heavy emphasis on Meta Ads, paid acquisition, e-commerce, conversion, and affiliate marketing.",
      requirements: [
        { text: "Meta Ads", kind: "MUST_HAVE", certainty: "required" },
        { text: "paid acquisition", kind: "MUST_HAVE", certainty: "required" },
        { text: "e-commerce", kind: "MUST_HAVE", certainty: "required" },
        { text: "conversion rate optimization", kind: "MUST_HAVE", certainty: "required" },
        { text: "affiliate marketing", kind: "MUST_HAVE", certainty: "required" }
      ],
      questions: ["Tell us about your affiliate marketing experience."]
    },
    {
      id: "TEST10",
      title: "Growth Marketing Manager",
      companyName: "Acme SaaS",
      description: "Heavy emphasis on SaaS, B2B, GTM, lifecycle marketing, retention, CRM, and product growth.",
      requirements: [
        { text: "SaaS", kind: "MUST_HAVE", certainty: "required" },
        { text: "B2B", kind: "MUST_HAVE", certainty: "required" },
        { text: "GTM", kind: "MUST_HAVE", certainty: "required" },
        { text: "lifecycle marketing", kind: "MUST_HAVE", certainty: "required" },
        { text: "CRM", kind: "MUST_HAVE", certainty: "required" },
        { text: "retention", kind: "MUST_HAVE", certainty: "required" }
      ],
      questions: ["Tell us about your CRM and lifecycle experience."]
    },
    {
      id: "TEST11",
      title: "Solutions Engineer",
      companyName: "B2B Tech",
      description: "A technical sales role requiring both software engineering knowledge and customer-facing presentation skills.",
      requirements: [
        { text: "Software Engineering", kind: "MUST_HAVE", certainty: "required" },
        { text: "Client presentations", kind: "MUST_HAVE", certainty: "required" },
        { text: "B2B Sales", kind: "MUST_HAVE", certainty: "required" }
      ],
      questions: ["Why are you a fit for Solutions Engineering?"]
    }
  ];

  for (const tJob of testJobs) {
    console.log(`\n==================================================`);
    console.log(`PROCESSING ${tJob.id}: ${tJob.title}`);
    console.log(`==================================================\n`);

    const fit = scoreJobFit(tJob as any, fullCandidate as any, tJob.requirements as any);
    console.log(`Assigned Career Lane: ${fit.profile}`);
    console.log(`Selected Projects:`, fit.selectedProjects.map(p => p.name));
    console.log(`Selected Experiences:`, fit.recommendedExperiences);
    
    // Simulate generation
    const draftCv = buildCvDraft(tJob as any, fullCandidate as any, fit);
    
    const evidence = [
      ...fullCandidate.facts.filter((fact) => fact.verified).map((fact) => fact.fact),
      ...fullCandidate.experiences.map((exp) => `${exp.title} at ${exp.organizationName}: ${exp.summary}`),
      ...fullCandidate.projects.map((proj) => `${proj.name} (${proj.role}): ${proj.description}`)
    ];

    console.log(`\n--- PROMPT TO DEEPSEEK ---`);
    console.log(evidencePrompt(evidence, draftCv.text, tJob.title, tJob.companyName, fit.profile, tJob.requirements.map(r => r.text)));
    
    console.log(`\n--- COVER LETTER ---`);
    const letter = await buildCoverLetter(tJob as any, fullCandidate as any, fit);
    console.log(letter);
    
    console.log(`\n--- ANSWERS ---`);
    for (const q of tJob.questions) {
       const ans = answerQuestion(q, tJob as any, fullCandidate as any, fit);
       console.log(`Q: ${q}\nA: ${ans.answer} (Source: ${ans.source})`);
    }
  }

}

run().catch(console.error).finally(() => prisma.$disconnect());
