import type { CandidateRecord, JobInput } from "@/lib/applications/types";
import type { FitResult } from "@/lib/applications/fit";
import { unsupportedClaims } from "@/lib/applications/claims";
import { bannedPhrases } from "@/lib/applications/writing";
import { assessWriting, humanRewrite } from "@/lib/applications/writing-quality";

import { completeJson } from "@/lib/ai/client";

export async function buildCoverLetter(job: JobInput, candidate: CandidateRecord, fit: FitResult) {
  const evidence = fit.strongEvidence.slice(0, 3);
  const project = fit.selectedProjects[0];
  const prompt = `Write a professional cover letter for the following candidate applying to the ${job.title} role at ${job.companyName}.
Do NOT write generic filler like "I am writing to express my interest".
Do NOT write "My background is in X and I have relevant experience that aligns with this role."
Instead, open by stating the role and immediately highlighting a specific, relevant experience that proves the candidate's capability.
Use ONLY the provided evidence.

Job Description:
${job.description}

Candidate Evidence:
${evidence.map((item) => `- ${item}`).join("\\n")}
${project ? `- Worked on ${project.name}: ${project.description}` : ""}

Return JSON format: {"text":"..."}`;

  const response = await completeJson([
    { role: "system", content: "You are a professional cover letter generator. Write a concise, factual, and highly specific cover letter." },
    { role: "user", content: prompt }
  ]);
  const parsed = JSON.parse(response.content) as { text?: string };
  if (!parsed.text) throw new Error("Empty cover letter from AI");
  
  const text = parsed.text.trim();
  const check = unsupportedClaims(text, candidate, [job.companyName]);
  if (!check.ok) throw new Error(`Unsupported cover letter claim: ${check.unsupported.join(", ")}`);
  return text;
}
