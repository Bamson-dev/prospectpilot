import { pageLooksThin } from "@/lib/research/extract";

export function needsBrowserRender(excerpt: string, html: string) {
  if (pageLooksThin(excerpt)) return true;
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  return scripts > 15 && excerpt.trim().length < 500;
}

export function httpStatusFromError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/status (\d{3})/);
  return match ? Number(match[1]) : 0;
}

const CHALLENGE = /unusual traffic|verify you are human|are you a robot|sign in to continue|log in to continue|cf-browser-verification/i;

export function pageAccessBlocked(input: { status?: number; html?: string }) {
  if (input.status === 401 || input.status === 403) return true;
  return CHALLENGE.test(input.html ?? "");
}

export function shouldUsePlaywright(input: { httpStatus: number; excerpt: string; html: string; scrapySufficient: boolean }) {
  if (input.scrapySufficient) return false;
  if (input.httpStatus === 401 || input.httpStatus === 403) return true;
  if (!input.html) return true;
  if (pageAccessBlocked({ status: input.httpStatus, html: input.html })) return true;
  return needsBrowserRender(input.excerpt, input.html);
}
