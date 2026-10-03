import { completeJson } from "@/lib/ai/client";
import { AppError } from "@/lib/errors";

export async function classifyAndDraftEmployerReply(
  subject: string,
  body: string,
  companyName: string,
  vacancyTitle: string,
  candidateName: string,
  candidateFacts: string[]
) {
  const prompt = `You are a professional recruitment assistant managing email correspondence for a candidate named ${candidateName}.
The candidate applied for the position of "${vacancyTitle}" at "${companyName}".

You have received an email from the employer.
Subject: ${subject}
Body:
${body}

Candidate Facts (DO NOT INVENT ANY INFORMATION OUTSIDE OF THIS):
${candidateFacts.map(f => `- ${f}`).join("\n")}

Analyze this email and output a JSON object with the following schema:
{
  "classification": "INTERVIEW_INVITATION" | "ASSESSMENT_REQUEST" | "REQUEST_FOR_INFORMATION" | "APPLICATION_RECEIVED" | "REJECTION" | "OFFER" | "NEXT_STAGE" | "NEEDS_REPLY" | "GENERAL_EMPLOYER_MESSAGE" | "UNKNOWN" | "MANUAL_REVIEW",
  "suggestedDraft": "..."
}

Drafting Rules:
1. The draft must answer the employer's actual question.
2. Remain professional, natural, and avoid generic AI filler (e.g., 'results-driven', 'thrilled').
3. DO NOT invent information or claim experience not present in the candidate facts.
4. DO NOT make unverified commitments (salary, scheduling, etc.) unless explicitly supported. If asked about availability and you don't know, draft a placeholder like '[Insert Availability]' or politely state you are available to discuss at their convenience.
5. If the email is a rejection, draft a polite, brief thank you note.
6. If the email is an interview invitation, express appreciation and provide a placeholder for availability.
7. If classification is UNKNOWN or MANUAL_REVIEW, leave suggestedDraft empty.`;

  const response = await completeJson([
    { role: "system", content: "You strictly output valid JSON matching the requested schema." },
    { role: "user", content: prompt }
  ]);

  try {
    const data = JSON.parse(response.content) as { classification: string; suggestedDraft: string };
    const validClassifications = [
      "INTERVIEW_INVITATION", "ASSESSMENT_REQUEST", "REQUEST_FOR_INFORMATION", 
      "APPLICATION_RECEIVED", "REJECTION", "OFFER", "NEXT_STAGE", "NEEDS_REPLY", 
      "GENERAL_EMPLOYER_MESSAGE", "UNKNOWN", "MANUAL_REVIEW"
    ];
    return {
      classification: validClassifications.includes(data.classification) ? data.classification : "UNKNOWN",
      suggestedDraft: data.suggestedDraft || "",
    };
  } catch {
    throw new AppError("Failed to parse AI response for employer reply.");
  }
}
