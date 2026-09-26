const UNSUBSCRIBE_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bremove me\b/i,
  /\bdo not contact\b/i,
  /\bdon't contact\b/i,
  /\bstop emailing\b/i,
  /\bstop contacting\b/i,
  /\btake me off\b/i,
];

export function isSuppressionRequest(text: string) {
  return UNSUBSCRIBE_PATTERNS.some((pattern) => pattern.test(text));
}
