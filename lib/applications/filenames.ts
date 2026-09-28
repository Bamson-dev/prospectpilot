export function documentFileName(input: { fullName: string; headline: string; companyName: string; extension: "pdf" | "docx" }) {
  const name = slug(input.fullName);
  const role = slug(input.headline);
  const company = slug(input.companyName);
  return `${name}-${role}-${company}.${input.extension}`;
}

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
