import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
  const candidate = await prisma.candidate.findFirst();
  if (!candidate) {
    console.log("No candidate found.");
    process.exit(1);
  }

  console.log(`Seeding evidence for candidate: ${candidate.fullName}`);

  // 1. Experiences
  const experiences = [
    {
      title: "Founder & Chief Marketing Officer",
      organizationName: "PromptEarn",
      summary: "growth marketing, performance marketing, GTM strategy, digital operations, affiliate growth, CRM workflows, marketing automation, 100,000+ affiliates within first year, 100,000+ users under 12 months, $1.5m cumulative platform revenue",
      profiles: ["MARKETING", "GROWTH", "FOUNDER", "HYBRID"]
    },
    {
      title: "Marketing Director",
      organizationName: "Globalwave Softech",
      summary: "SaaS marketing, growth strategy, performance campaigns, 10,000 -> 65,000 active users, 20% churn reduction, B2B demand generation, account-based marketing",
      profiles: ["MARKETING", "GROWTH", "SAAS", "HYBRID"]
    },
    {
      title: "Head of Marketing",
      organizationName: "Silverline E-commerce",
      summary: "end-to-end marketing, ₦15M -> ₦120M monthly revenue, performance marketing, affiliate programs, influencer partnerships, 35% increase in repeat customer rate, 7-figure monthly affiliate/influencer sales",
      profiles: ["MARKETING", "GROWTH", "WEB", "HYBRID"]
    },
    {
      title: "Growth Marketing Specialist",
      organizationName: "Zenith Technologies",
      summary: "B2B/B2C GTM, 30% product adoption increase, 25% acquisition cost reduction, automation, CRO, channel optimization, sales/marketing alignment",
      profiles: ["MARKETING", "GROWTH", "SAAS", "HYBRID"]
    },
    {
      title: "Digital Marketing Executive",
      organizationName: "Interswitch Group",
      summary: "fintech marketing, 20% product uptake increase, 45% digital engagement increase",
      profiles: ["MARKETING", "GROWTH", "HYBRID"]
    },
    {
      title: "Marketing Associate",
      organizationName: "Aramco",
      summary: "corporate/regional digital marketing, West Africa, digital-first marketing, 30% regional brand visibility increase, 1M+ audience reach",
      profiles: ["MARKETING", "GROWTH", "HYBRID"]
    },
    {
      title: "Junior Digital Marketer",
      organizationName: "Swift Digital Solutions",
      summary: "social media, paid advertising, website optimization, 20% traffic increase, campaign reporting",
      profiles: ["MARKETING"]
    },
    {
      title: "Digital Marketing Intern",
      organizationName: "New Horizons",
      summary: "SEO, social media, digital advertising, SME marketing, analytics, client training",
      profiles: ["MARKETING"]
    }
  ];

  for (const exp of experiences) {
    const existing = await prisma.candidateExperience.findFirst({
      where: { candidateId: candidate.id, organizationName: exp.organizationName }
    });
    if (existing) {
      await prisma.candidateExperience.update({
        where: { id: existing.id },
        data: {
          title: exp.title,
          summary: exp.summary,
          profiles: exp.profiles as any,
          verified: true
        }
      });
    } else {
      await prisma.candidateExperience.create({
        data: {
          candidateId: candidate.id,
          title: exp.title,
          organizationName: exp.organizationName,
          summary: exp.summary,
          profiles: exp.profiles as any,
          verified: true,
          source: "CV",
          current: false
        }
      });
    }
  }

  // 2. Projects
  const projects = [
    {
      name: "LeadThur",
      role: "Software Developer",
      description: "B2B contact discovery platform with custom search, subscriber dashboard, subscription billing, Paystack integration, SaaS functionality, B2B functionality.",
      technologies: ["SaaS", "B2B", "Paystack", "TypeScript"],
      features: ["Custom search", "Subscriber dashboard", "Subscription billing"],
      outcomes: ["Generated ₦15M+ in its first three months"],
      profiles: ["SOFTWARE", "WEB", "SAAS", "HYBRID"]
    },
    {
      name: "DigitalSkillX",
      role: "Software Developer",
      description: "Custom LMS with course management, student progress tracking, certificates, NGN payments, USD payments, admin backend, instructor backend.",
      technologies: ["LMS", "Payment Gateways", "Backend"],
      features: ["Course management", "Progress tracking", "Certificates", "Payments"],
      outcomes: [],
      profiles: ["SOFTWARE", "WEB", "HYBRID"]
    },
    {
      name: "Adley",
      role: "Software Developer",
      description: "AI media buyer Telegram bot with Telegram interface, Meta advertising analysis, CSV/XLSX report processing, report analysis, persistent context.",
      technologies: ["Telegram Bot", "Meta Ads API", "AI", "CSV/XLSX processing"],
      features: ["Telegram interface", "Advertising analysis", "Report processing"],
      outcomes: ["5,000+ active users"],
      profiles: ["SOFTWARE", "WEB", "HYBRID"]
    },
    {
      name: "E-commerce Platform",
      role: "Software Developer",
      description: "Documented client project containing storefront, order management, customer management, inventory, payment processing, analytics, campaign management, coupon management, built-in CRM.",
      technologies: ["E-commerce", "CRM", "Payment Processing"],
      features: ["Storefront", "Order management", "Inventory", "Analytics"],
      outcomes: [],
      profiles: ["SOFTWARE", "WEB", "SAAS", "HYBRID"]
    },
    {
      name: "Crypto Investment Platform",
      role: "Software Developer",
      description: "Documented client project containing Nigerian-market crypto platform, NGN, BTC, ETH, USDT, USDC, investor application, portfolio management, wallet, KYC, buy/sell functionality, admin system, compliance, risk management, audit modules, PostgreSQL ledger.",
      technologies: ["Crypto", "PostgreSQL", "KYC", "Wallet Integration"],
      features: ["Portfolio management", "Buy/sell functionality", "Admin system", "Compliance"],
      outcomes: [],
      profiles: ["SOFTWARE", "WEB", "HYBRID"]
    },
    {
      name: "AI Chat Application",
      role: "Software Developer",
      description: "Documented application containing AI chat, conversation history, image upload, markdown, light/dark mode, Naija Mode, WhatsApp Reply Generator, content generator, prompt library, export functionality.",
      technologies: ["AI", "Markdown", "Image processing"],
      features: ["Conversation history", "Image upload", "Prompt library", "Export"],
      outcomes: [],
      profiles: ["SOFTWARE", "WEB", "HYBRID"]
    }
  ];

  for (const proj of projects) {
    const existing = await prisma.candidateProject.findFirst({
      where: { candidateId: candidate.id, name: proj.name }
    });
    if (existing) {
      await prisma.candidateProject.update({
        where: { id: existing.id },
        data: {
          description: proj.description,
          technologies: proj.technologies,
          features: proj.features,
          outcomes: proj.outcomes,
          profiles: proj.profiles as any,
          verified: true
        }
      });
    } else {
      await prisma.candidateProject.create({
        data: {
          candidateId: candidate.id,
          name: proj.name,
          role: proj.role,
          description: proj.description,
          technologies: proj.technologies,
          features: proj.features,
          outcomes: proj.outcomes,
          profiles: proj.profiles as any,
          verified: true,
          source: "CV"
        }
      });
    }
  }

  // 3. Education
  const education = await prisma.candidateEducation.findFirst({
    where: { candidateId: candidate.id, institution: "National Open University of Nigeria (NOUN)" }
  });
  if (!education) {
    await prisma.candidateEducation.create({
      data: {
        candidateId: candidate.id,
        institution: "National Open University of Nigeria (NOUN)",
        degree: "Bachelor of Science (B.Sc.)",
        source: "CV"
      }
    });
  }

  console.log("Master profile seeding complete.");
}

run().catch(console.error).finally(() => prisma.$disconnect());
