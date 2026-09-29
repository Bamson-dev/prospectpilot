export type ProfileDraft = {
  email: string;
  phone: string | null;
  location: string | null;
  headline: string | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
  githubUrl: string | null;
  yearsExperience: number | null;
  currentRole: string | null;
  targetRoles: string[];
  workAuthorization: string | null;
  sponsorship: string | null;
  availability: string | null;
  noticePeriod: string | null;
  employmentPreference: string | null;
  remotePreference: string | null;
  relocationPreference: string | null;
  salaryMin: number | null;
  salaryTarget: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  institution: string | null;
  degree: string | null;
  field: string | null;
  educationStart: string | null;
  educationEnd: string | null;
  certification: string | null;
  issuer: string | null;
  certificationDate: string | null;
  credentialUrl: string | null;
};

export function validateCandidateProfile(formData: FormData): { error: string | null; draft: ProfileDraft | null } {
  const email = text(formData, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith("@invalid.test")) {
    return { error: "Enter a real email address.", draft: null };
  }
  const phone = text(formData, "phone");
  const phoneError = validatePhone(phone);
  if (phoneError) return { error: phoneError, draft: null };
  const linkedinUrl = text(formData, "linkedin");
  if (linkedinUrl && !/^https:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(linkedinUrl)) {
    return { error: "LinkedIn must be an https:// LinkedIn URL, or stay blank.", draft: null };
  }
  const githubUrl = text(formData, "github");
  if (githubUrl && !/^https:\/\/([a-z0-9-]+\.)*github\.com\//i.test(githubUrl)) {
    return { error: "GitHub must be an https:// GitHub URL, or stay blank.", draft: null };
  }
  const portfolioUrl = text(formData, "portfolio");
  if (portfolioUrl && !/^https:\/\/[^\s]+$/i.test(portfolioUrl)) {
    return { error: "Portfolio must be an https URL, or stay blank.", draft: null };
  }
  const yearsRaw = text(formData, "yearsExperience");
  let yearsExperience: number | null = null;
  if (yearsRaw) {
    if (!/^\d{1,2}$/.test(yearsRaw)) return { error: "Years of experience must be a whole number, or stay blank.", draft: null };
    yearsExperience = Number(yearsRaw);
  }
  const salary = readSalary(formData);
  if (salary.error) return { error: salary.error, draft: null };
  const educationStart = text(formData, "educationStart");
  const educationEnd = text(formData, "educationEnd");
  const dateError = validateDateOrder(educationStart, educationEnd);
  if (dateError) return { error: dateError, draft: null };
  const certificationDate = text(formData, "certificationDate");
  if (certificationDate && !validDate(certificationDate)) return { error: "Certification date is not a valid date.", draft: null };
  const credentialUrl = text(formData, "credentialUrl");
  if (credentialUrl && !/^https:\/\/[^\s]+$/i.test(credentialUrl)) {
    return { error: "Credential URL must be https, or stay blank.", draft: null };
  }
  const institution = text(formData, "institution");
  const certification = text(formData, "certification");
  if ((text(formData, "degree") || text(formData, "field") || educationStart || educationEnd) && !institution) {
    return { error: "Education needs an institution, or leave the education fields blank.", draft: null };
  }
  if ((text(formData, "issuer") || certificationDate || credentialUrl) && !certification) {
    return { error: "A certification needs a name, or leave the certification fields blank.", draft: null };
  }
  return {
    error: null,
    draft: {
      email,
      phone: phone || null,
      location: text(formData, "location") || null,
      headline: text(formData, "headline") || null,
      linkedinUrl: linkedinUrl || null,
      portfolioUrl: portfolioUrl || null,
      githubUrl: githubUrl || null,
      yearsExperience,
      currentRole: text(formData, "currentRole") || null,
      targetRoles: text(formData, "targetRoles").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12),
      workAuthorization: text(formData, "workAuthorization") || null,
      sponsorship: text(formData, "sponsorship") || null,
      availability: text(formData, "availability") || null,
      noticePeriod: text(formData, "noticePeriod") || null,
      employmentPreference: text(formData, "employmentPreference") || null,
      remotePreference: text(formData, "remotePreference") || null,
      relocationPreference: text(formData, "relocationPreference") || null,
      salaryMin: salary.min,
      salaryTarget: salary.target,
      salaryCurrency: salary.currency,
      salaryPeriod: salary.period,
      institution: institution || null,
      degree: text(formData, "degree") || null,
      field: text(formData, "field") || null,
      educationStart: educationStart || null,
      educationEnd: educationEnd || null,
      certification: certification || null,
      issuer: text(formData, "issuer") || null,
      certificationDate: certificationDate || null,
      credentialUrl: credentialUrl || null,
    },
  };
}

export function validatePhone(value: string) {
  if (!value) return null;
  if (!/^\+?[0-9][0-9().\-\s]{6,22}$/.test(value)) return "Enter a phone number with digits, or leave it blank.";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return "Enter a phone number with 7 to 15 digits, or leave it blank.";
  return null;
}

export function validateDateOrder(start: string, end: string) {
  if (start && !validDate(start)) return "Education start date is not a valid date.";
  if (end && !validDate(end)) return "Education end date is not a valid date.";
  if (start && end && end < start) return "Education end date cannot precede the start date.";
  return null;
}

function readSalary(formData: FormData) {
  const minRaw = text(formData, "salaryMin");
  const targetRaw = text(formData, "salaryTarget");
  const currency = text(formData, "salaryCurrency").toUpperCase();
  const period = text(formData, "salaryPeriod").toLowerCase();
  const any = Boolean(minRaw || targetRaw || currency || period);
  if (!any) return { error: null, min: null as number | null, target: null as number | null, currency: null as string | null, period: null as string | null };
  if (!minRaw && !targetRaw) return { error: "Salary needs a minimum or a target amount.", min: null, target: null, currency: null, period: null };
  if (minRaw && !/^\d{1,9}$/.test(minRaw)) return { error: "Minimum salary must be a number.", min: null, target: null, currency: null, period: null };
  if (targetRaw && !/^\d{1,9}$/.test(targetRaw)) return { error: "Target salary must be a number.", min: null, target: null, currency: null, period: null };
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "Salary needs a 3-letter currency code.", min: null, target: null, currency: null, period: null };
  if (!["year", "month", "hour", "day"].includes(period)) return { error: "Salary needs a period: year, month, day, or hour.", min: null, target: null, currency: null, period: null };
  return { error: null, min: minRaw ? Number(minRaw) : null, target: targetRaw ? Number(targetRaw) : null, currency, period };
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
}
