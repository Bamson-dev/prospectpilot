import { prisma } from "../lib/db";
import { completeJson, hashInput } from "../lib/ai/client";
import { emailPrompt } from "../lib/ai/prompts";
import { emailDraftSchema, extractJsonObject } from "../lib/ai/schemas";

const prospects = [
  {
    companyName: "Chas Everitt International Property Group",
    industry: "Real Estate",
    recommendedService: "paid acquisition systems",
    personalizationAngle: "multi-market property network",
    contacts: [{ fullName: "Beverly" }],
    research: [{
      excerpt: "Chas Everitt International Property Group is a LeadingRE member based in Johannesburg, South Africa. Founded in 1980 by Charles (Chas) and Tilla Everitt, who remain active in the group and the real estate industry, it operates as a family business. Coverage across South Africa and international affiliations support client relocation to any town or city in South Africa or around the world.",
    }],
  },
  {
    companyName: "Acme SaaS",
    industry: "SaaS",
    recommendedService: "customer workflow automation",
    personalizationAngle: "rapid team scaling",
    contacts: [{ fullName: "John" }],
    research: [{
      excerpt: "Acme SaaS is a fast-growing software company specializing in HR management solutions for mid-sized enterprises. Founded in 2018, they recently raised $15M in Series B funding to expand their sales team and scale their product offering across Europe. They have a strong online presence but often struggle with onboarding velocity.",
    }],
  },
  {
    companyName: "StyleCart",
    industry: "Ecommerce",
    recommendedService: "conversion rate optimization",
    personalizationAngle: "high cart abandonment in luxury goods",
    contacts: [{ fullName: "Sarah" }],
    research: [{
      excerpt: "StyleCart is an emerging luxury fashion ecommerce brand selling high-end accessories. They rely heavily on Instagram influencers and Meta ads for traffic. Recent reviews mention a clunky checkout process, and their main focus this quarter is improving overall store conversion rates before the holiday season.",
    }],
  },
  {
    companyName: "Apex Legal Partners",
    industry: "Professional Services",
    recommendedService: "lead generation funnels",
    personalizationAngle: "corporate law practice expansion",
    contacts: [{ fullName: "Michael" }],
    research: [{
      excerpt: "Apex Legal Partners is a corporate law firm based in London, UK. They specialize in M&A and intellectual property law. Most of their business comes from referrals, and they have almost no digital acquisition strategy despite launching a new service tailored for tech startups last month.",
    }],
  },
  {
    companyName: "DataSync Tech",
    industry: "Technology/Software",
    recommendedService: "custom API development",
    personalizationAngle: "legacy system modernization",
    contacts: [{ fullName: "David" }],
    research: [{
      excerpt: "DataSync Tech provides enterprise data integration solutions. Their main product helps legacy banking systems talk to modern cloud infrastructure. They recently announced a push into the healthcare sector but their current integration tools require heavy manual configuration for HIPAA compliance.",
    }],
  }
];

async function main() {


  for (const prospect of prospects) {
    const contact = prospect.contacts[0];
    const research = prospect.research[0];
    
    if (!research || !research.excerpt) continue;

    console.log(`\n==================================================`);
    console.log(`PROSPECT: ${prospect.companyName}`);
    console.log(`INDUSTRY: ${prospect.industry}`);
    console.log(`SELECTED SERVICE: ${prospect.recommendedService}`);
    
    const input = {
      companyName: prospect.companyName,
      contactName: contact?.fullName ?? null,
      evidence: research.excerpt.slice(0, 3000),
      angle: prospect.personalizationAngle,
      recommendedService: prospect.recommendedService,
    };

    const messages = emailPrompt(input);
    let bestDraft: any = null;
    let highestScore = -1;

    for (let i = 1; i <= 3; i++) {
      try {
        const result = await completeJson(messages);
        const parsed = emailDraftSchema.parse(extractJsonObject(result.content));
        
        const { relevance, commercialClarity, offerStrength, naturalness, subjectQuality, spamRisk } = parsed.qualityScore;
        const total = relevance + commercialClarity + offerStrength + naturalness + subjectQuality - spamRisk;
        
        if (!bestDraft || total > highestScore) {
          bestDraft = parsed;
          highestScore = total;
        }

        if (relevance >= 7 && commercialClarity >= 7 && offerStrength >= 6 && naturalness >= 7 && subjectQuality >= 7 && spamRisk <= 3) {
          break; // Good enough
        }
      } catch (err) {
        console.error("Attempt", i, "failed:", err);
      }
    }

    if (bestDraft) {
      console.log(`COMMERCIAL OPPORTUNITY: ${bestDraft.commercialOpportunity}`);
      console.log(`\nSUBJECT CANDIDATES:`);
      bestDraft.subjectCandidates.forEach((c: string) => console.log(` - ${c}`));
      
      console.log(`\nSELECTED SUBJECT: ${bestDraft.subject}`);
      console.log(`PREHEADER: ${bestDraft.preheader}`);
      
      console.log(`\n--- EMAIL BODY ---`);
      console.log(bestDraft.body);
      console.log(`\n--- QUALITY SCORES ---`);
      console.log(bestDraft.qualityScore);
      console.log(`\nREASON IT IS RELEVANT:`);
      console.log(bestDraft.researchRanking.join("\n"));
    }
  }
}

main().catch(console.error).finally(() => process.exit(0));
