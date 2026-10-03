import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import { logError } from "@/lib/logger";

type Message = { role: "system" | "user"; content: string };

export function hashInput(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function completeJson(messages: Message[]) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    if (process.env.DATABASE_URL?.includes("_test")) {
      console.log("\\n--- PROMPT TO DEEPSEEK ---");
      console.log(messages.map(m => m.content).join("\\n\\n"));
      console.log("----------------------------\\n");
      return { content: JSON.stringify({ text: "Generated text. Candidate matches the requirements." }), model: "test-mock", durationMs: 0 };
    }
    throw new AppError("DeepSeek is not configured.");
  }
  const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const endpoint = new URL(base);
  if (endpoint.protocol !== "https:") throw new AppError("DEEPSEEK_BASE_URL must use https.");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const started = Date.now();
  const response = await fetch(`${endpoint.origin}${endpoint.pathname === "/" ? "" : endpoint.pathname}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages,
    }),
  });
  if (!response.ok) {
    logError("deepseek.failed", { status: response.status, durationMs: Date.now() - started });
    throw new AppError(`DeepSeek returned status ${response.status}.`);
  }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new AppError("DeepSeek returned an empty response.");
  return { content, model, durationMs: Date.now() - started };
}
