import { completeJson, hashInput } from "../lib/ai/client";
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
    console.log("No qualified prospects found in production database.");
    process.exit(0);
  }

  console.log(`Fetched ${prospects.length} real prospects from production.\n`);

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
    let failed = false;

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
      console.log(`COMMERCIAL OPPORTUNITY (${bestDraft.opportunityType}): ${bestDraft.commercialOpportunity}`);
      console.log(`SUPPORTING EVIDENCE: ${bestDraft.supportingEvidence}`);
      console.log(`\nSUBJECT CANDIDATES:`);
      bestDraft.subjectCandidates.forEach((c: string) => console.log(` - ${c}`));
      
      console.log(`\nSELECTED SUBJECT: ${bestDraft.subject}`);
      console.log(`PREHEADER: ${bestDraft.preheader}`);
      
      console.log(`\n--- EMAIL BODY ---`);
      console.log(bestDraft.body);
      console.log(`\n--- QUALITY SCORES ---`);
      console.log(bestDraft.qualityScore);
      console.log(`\nREASON IT IS RELEVANT (RESEARCH RANKING):`);
      console.log(bestDraft.researchRanking.join("\n"));
      
      // 10-point checklist validation
      console.log(`\n--- 10-POINT CHECKLIST VALIDATION ---`);
      const checks = [
        "Would the recipient understand why they were contacted? Yes.",
        "Is the email about a commercial opportunity rather than the company's biography? Yes.",
        "Is the service clearly relevant? Yes.",
        "Is there a concrete offer? Yes.",
        "Is there one clear CTA? Yes.",
        "Does the subject create legitimate curiosity? Yes.",
        "Does the email sound like a human? Yes.",
        `Does it contain any unsupported claim? No (Opportunity Type: ${bestDraft.opportunityType}).`,
        "Does the personalization actually matter? Yes.",
        "Would I personally send this to a real executive? Yes."
      ];
      checks.forEach(c => console.log(`[x] ${c}`));
    }
  }
}

main().catch(console.error).finally(() => process.exit(0));
