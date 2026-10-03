import { completeJson } from "@/lib/ai/client";
import { AppError } from "@/lib/errors";

export async function classifyAndDraftEmployerReply(
  subject: string,
  body: string,
  companyName: string,
  vacancyTitle: string,
  candidateName: string
) {
  const prompt = `You are a recruitment assistant managing email correspondence for a candidate named ${candidateName}.
The candidate applied for the position of "${vacancyTitle}" at "${companyName}".

You have received an email from the employer.
Subject: ${subject}
Body:
${body}

Analyze this email and output a JSON object with the following schema:
{
  "classification": "INTERVIEW_INVITATION" | "REJECTION" | "OFFER" | "MORE_INFO_REQUESTED" | "UNKNOWN",
  "suggestedDraft": "A professional, concise draft reply from the candidate. If the email is a rejection, draft a polite thank you note. If it's an interview invitation, express excitement and provide availability."
}`;

  const response = await completeJson([
    { role: "system", content: "You strictly output valid JSON matching the requested schema." },
    { role: "user", content: prompt }
  ]);

  try {
    const data = JSON.parse(response.content) as { classification: string; suggestedDraft: string };
    return {
      classification: data.classification || "UNKNOWN",
      suggestedDraft: data.suggestedDraft || "",
    };
  } catch {
    throw new AppError("Failed to parse DeepSeek response for employer reply.");
  }
}
