export function validateResumePackage(input: {
  pdf: Uint8Array;
  docx: Uint8Array;
  fileName: string;
  text: string;
  candidateName: string;
  email: string;
}) {
  const problems: string[] = [];
  if (input.pdf.byteLength < 5 || ascii(input.pdf, 5) !== "%PDF-") problems.push("PDF is missing or empty.");
  if (input.docx.byteLength < 4 || input.docx[0] !== 0x50 || input.docx[1] !== 0x4b) problems.push("DOCX is missing or empty.");
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\.pdf$/.test(input.fileName)) problems.push("Resume filename is not a professional PDF name.");
  if (!input.text.includes(input.candidateName)) problems.push("Candidate name is not in the resume.");
  if (/invalid\.test|placeholder|fake@/i.test(`${input.email}\n${input.text}`)) problems.push("Resume contact information is a placeholder.");
  return { ok: problems.length === 0, problems, preferredUpload: "pdf" as const };
}

export function validateCoverLetterForVacancy(input: { text: string; companyName: string; title: string; otherCompany?: string }) {
  const problems: string[] = [];
  const text = input.text.toLowerCase();
  if (!input.companyName || !text.includes(input.companyName.toLowerCase())) problems.push("Cover letter does not name this company.");
  if (!input.title || !text.includes(input.title.toLowerCase())) problems.push("Cover letter does not name this role.");
  if (input.otherCompany && text.includes(input.otherCompany.toLowerCase())) problems.push("Cover letter names a different company.");
  return { ok: problems.length === 0, problems };
}

function ascii(bytes: Uint8Array, length: number) {
  return String.fromCharCode(...bytes.slice(0, length));
}
