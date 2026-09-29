export function authenticationRequired(input: { text: string; fieldTypes?: Array<string | null | undefined> }) {
  if ((input.fieldTypes ?? []).some((type) => (type ?? "").toLowerCase() === "password")) return true;
  const text = input.text.toLowerCase();
  return /sign in to apply|log in to apply|login to apply|sign-in required|sign in|log in|sso\b|oauth|create an account|employer portal|session required|account required to apply/.test(text);
}
