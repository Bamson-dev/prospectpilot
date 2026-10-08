import { completeJson } from "../lib/ai/client";
import { emailPrompt } from "../lib/ai/prompts";
import { emailDraftSchema, extractJsonObject } from "../lib/ai/schemas";

async function main() {
  const response = await fetch("https://leadpilot.live/api/diagnostics/get-prospects");
  if (!response.ok) {
    console.error("Failed to fetch prospects from production:", await response.text());
    process.exit(1);
  }
  
  const prospects = await response.json();
  if (prospects.length === 0) {
    console.log("No qualified prospects found.");
    process.exit(0);
  }

  // Iterate over up to 10 prospects
  for (let i = 0; i < Math.min(10, prospects.length); i++) {
    const prospect = prospects[i];
    const contact = prospect.contacts[0];
    const research = prospect.research[0];
    
    console.log(`\n==================================================`);
    console.log(`PROSPECT [${i+1}/10]: ${prospect.companyName}`);
    
    const input = {
      companyName: prospect.companyName,
      contactName: contact?.fullName ?? null,
      evidence: research.excerpt?.slice(0, 3000) ?? "",
      angle: prospect.personalizationAngle,
      recommendedService: prospect.recommendedService,
    };

    const messages = emailPrompt(input);
    const result = await completeJson(messages);
    const parsed = emailDraftSchema.parse(extractJsonObject(result.content));
    
    console.log(`OPPORTUNITY CLASSIFICATION: ${parsed.opportunityType}`);
    console.log(`SELECTED SERVICE: ${parsed.serviceMatch}`);
    console.log(`OFFER: ${parsed.valueProposition}`);
    console.log(`CTA: ${parsed.cta}`);

    console.log(`\n--- INTERNAL VERSIONS GENERATED ---`);
    parsed.versions.forEach((v: any, index: number) => {
      console.log(`\nVERSION ${index + 1} (${v.approach}):`);
      console.log(`Subject Candidates: ${v.subjectCandidates.join(" | ")}`);
      console.log(`Scores: Relevance(${v.scores.relevance}), Curiosity(${v.scores.curiosity}), Clarity(${v.scores.commercialClarity}), Naturalness(${v.scores.naturalness}), ReplyLikelihood(${v.scores.replyLikelihood})`);
      console.log(`Body:\n${v.body}`);
    });
    
    console.log(`\n--- SELECTED FINAL VERSION ---`);
    console.log(`SUBJECT: ${parsed.subject}`);
    console.log(`PREHEADER: ${parsed.preheader}`);
    
    console.log(`\n--- RAW BODY ---`);
    console.log(parsed.body);
    
    // Format exactly like worker/processors/outreach.ts
    const token = "mock-jwt-token-12345";
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://leadpilot.live";
    const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${token}`;

    const bodyWithHtml = `${parsed.body.replace(/\n/g, "<br>")}

<br><br>
<small><a href="${unsubscribeUrl}">unsubscribe here</a></small>`;

    console.log(`\n--- COMPLETE HTML EMAIL (AS RENDERED BY OUTREACH PROCESSOR) ---`);
    console.log(bodyWithHtml);

    console.log(`\n--- QUALITY SCORE ---`);
    console.log(parsed.qualityScore);
  }
}

main().catch(console.error).finally(() => process.exit(0));
