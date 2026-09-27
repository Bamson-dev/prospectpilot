import { pageLooksThin } from "@/lib/research/extract";

export function needsBrowserRender(excerpt: string, html: string) {
  if (pageLooksThin(excerpt)) return true;
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  return scripts > 15 && excerpt.trim().length < 500;
}
