import type { MappedAnswer } from "@/lib/applications/form-map";

export function applicationPreview(input: {
  company: string;
  role: string;
  resumeFileName: string | null;
  coverLetterFileName: string | null;
  fields: MappedAnswer[];
  captcha: boolean;
  authentication: boolean;
}) {
  const unresolved = input.fields.filter((field) => field.required && field.status !== "ANSWERED");
  const lines = [
    "APPLICATION PREVIEW",
    `Company: ${input.company}`,
    `Role: ${input.role}`,
    `Resume: ${input.resumeFileName ?? "not prepared"}`,
    `Cover letter: ${input.coverLetterFileName ?? "not prepared"}`,
    "Fields:",
    ...input.fields.slice(0, 40).map((field) => `${field.name || field.taxonomy}: ${field.value ?? "unknown"} STATUS: ${field.status}${field.source ? ` SOURCE: ${field.source}` : ""}`),
    `Required unresolved: ${unresolved.length}`,
    `CAPTCHA: ${input.captcha ? "DETECTED" : "not detected"}`,
    `Authentication: ${input.authentication ? "DETECTED" : "not detected"}`,
    `Result: ${input.captcha || input.authentication || unresolved.length ? "REQUIRES_MANUAL_ACTION" : "READY_FOR_HUMAN_SUBMISSION"}`,
  ];
  return { text: lines.join("\n"), unresolvedRequired: unresolved.length, result: lines.at(-1)?.replace("Result: ", "") ?? "REQUIRES_MANUAL_ACTION" };
}
