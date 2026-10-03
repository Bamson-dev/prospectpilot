import { PrismaClient } from '@prisma/client';
import { seedCandidateRecord, CAREER_PROFILES } from '../lib/applications/seed-data';

const prisma = new PrismaClient();

async function run() {
  console.log("Preconfiguring account for Bamidele Matthew...");

  // 1. Identify or Create User
  let user = await prisma.user.findFirst({ where: { email: "Bamzonline01@gmail.com" } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: "Bamzonline01@gmail.com",
        name: "Bamidele Matthew",
        passwordHash: "oauth-only", 
      }
    });
    console.log("Created user.");
  } else {
    console.log("User already exists.");
  }

  // 2. Identify or Create Organization
  let membership = await prisma.membership.findFirst({ where: { userId: user.id }, include: { organization: true } });
  let org;
  if (!membership) {
    org = await prisma.organization.create({
      data: {
        name: "Personal Workspace",
        slug: "personal-workspace",
      }
    });
    await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        role: "OWNER",
      }
    });
    console.log("Created organization.");
  } else {
    org = membership.organization;
    console.log("Organization already exists.");
  }

  // 3. Identify or Create Candidate
  let candidate = await prisma.candidate.findFirst({ where: { organizationId: org.id } });
  if (!candidate) {
    candidate = await prisma.candidate.create({
      data: {
        organizationId: org.id,
        fullName: "Bamidele Matthew",
        firstName: "Bamidele",
        lastName: "Matthew",
        email: "Bamzonline01@gmail.com",
      }
    });
    console.log("Created candidate.");
  }

  // 4. Update Profile
  await prisma.candidate.update({
    where: { id: candidate.id },
    data: {
      fullName: "Bamidele Matthew",
      firstName: "Bamidele",
      lastName: "Matthew",
      email: "Bamzonline01@gmail.com",
      phone: "+2349023986992",
      location: "Nigeria",
      linkedinUrl: "https://www.linkedin.com/in/bamidele-matthew-38b7b823",
      targetRoles: [
        "Growth Marketing Manager",
        "Growth Marketing Lead",
        "Performance Marketing Manager",
        "Digital Marketing Manager",
        "Growth Strategist",
        "Go-To-Market Manager",
        "Demand Generation Manager",
        "Product Marketing Manager",
        "Marketing Operations Manager",
        "Marketing Director",
        "Marketing Lead"
      ],
      remotePreference: "REMOTE_AND_LOCAL", // Remote, Hybrid, On-site
    }
  });
  console.log("Updated candidate profile.");

  // 5. Update Preferences
  await prisma.candidatePreference.upsert({
    where: { candidateId: candidate.id },
    create: {
      candidateId: candidate.id,
      discoverJobs: true,
      dailyTarget: 500,
      mode: "AUTO_PREPARE", // do not enable live submission
      remoteOnly: false,
    },
    update: {
      discoverJobs: true,
      dailyTarget: 500,
      mode: "AUTO_PREPARE", // do not enable live submission
      remoteOnly: false,
    }
  });
  console.log("Updated job preferences.");

  // 6. Delete old experiences/projects/facts to prevent duplication on multiple runs
  await prisma.candidateExperience.deleteMany({ where: { candidateId: candidate.id } });
  await prisma.candidateFact.deleteMany({ where: { candidateId: candidate.id } });

  // 7. Add Experiences
  const experiences = [
    { title: "Founder / CMO", organizationName: "PromptEarn", startDate: "Apr 2023", endDate: "Present" },
    { title: "Marketing Director", organizationName: "Globalwave Softech", startDate: "Aug 2022", endDate: "Sep 2023" },
    { title: "Head of Marketing", organizationName: "Silverline E-commerce", startDate: "Apr 2021", endDate: "Jul 2022" },
    { title: "Growth Marketing Specialist", organizationName: "Zenith Technologies", startDate: "Oct 2018", endDate: "Dec 2020" },
    { title: "Digital Marketing Executive", organizationName: "Interswitch Group", startDate: "Mar 2018", endDate: "Oct 2018" },
    { title: "Marketing Associate", organizationName: "Aramco", startDate: "Feb 2016", endDate: "Nov 2017" },
    { title: "Junior Digital Marketer", organizationName: "Swift Digital Solutions", startDate: "Aug 2015", endDate: "Dec 2015" },
    { title: "Digital Marketing Intern", organizationName: "New Horizons", startDate: "Jan 2015", endDate: "Jul 2015" },
  ];

  for (const exp of experiences) {
    await prisma.candidateExperience.create({
      data: {
        candidateId: candidate.id,
        title: exp.title,
        organizationName: exp.organizationName,
        summary: `Employed from ${exp.startDate} to ${exp.endDate}. Detailed responsibilities available in base CV.`,
        verified: true,
        source: "USER_PROVIDED",
        profiles: ["MARKETING", "GROWTH", "FOUNDER"],
      }
    });
  }
  console.log("Added professional experience records.");

  // 8. Add Certifications (Facts)
  const certs = [
    "Google Digital Skills for Africa",
    "Meta Blueprint Performance Marketing & Growth Strategy",
    "SEO & Analytics Fundamentals",
    "Marketing Automation & Funnel Optimization"
  ];
  for (const cert of certs) {
    await prisma.candidateFact.create({
      data: {
        candidateId: candidate.id,
        category: "CERTIFICATION",
        fact: `Certified in ${cert}`,
        verified: true,
        source: "USER_PROVIDED",
        profiles: ["MARKETING", "GROWTH"],
        keywords: [],
        skills: [],
        technologies: [],
      }
    });
  }
  console.log("Added certifications as verified evidence.");

  // 9. Core Skills
  const skills = [
    "GTM Strategy", "Market Entry", "Growth Marketing", "Performance Advertising", "Funnel Design", "Conversion Optimization", "Monetization", "Audience Psychology", "Consumer Insights", "Brand Positioning", "Messaging", "Content Strategy", "Product Launches", "Digital Education", "Affiliate Growth", "Partnership Growth", "Marketing Automation", "CRM", "B2B", "B2C", "SaaS", "Fintech", "E-commerce", "EdTech", "Data-driven marketing"
  ];
  for (const skill of skills) {
    await prisma.candidateFact.create({
      data: {
        candidateId: candidate.id,
        category: "EXPERIENCE",
        fact: `Expertise in ${skill}`,
        verified: true,
        source: "USER_PROVIDED",
        profiles: ["MARKETING", "GROWTH", "FOUNDER"],
        keywords: [skill],
        skills: [skill],
        technologies: [],
      }
    });
  }
  console.log("Added core skills as verified evidence.");

  // Application Answers (the user said: "Populate recurring application answers ONLY when the answer is already known... Do not guess: work authorization, sponsorship, salary, notice period... If genuinely not present, leave them as REQUIRES USER INPUT")
  // Since we don't have them in the provided data, we leave the fields null. The schema defaults to null.
  
  console.log("Account successfully preconfigured!");
}

run().catch(console.error).finally(() => prisma.$disconnect());
