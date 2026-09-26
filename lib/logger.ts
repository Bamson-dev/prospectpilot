const SECRET_PARTS = ["password", "secret", "token", "authorization", "api_key", "apikey", "credential", "cookie"];

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (SECRET_PARTS.some((part) => lower.includes(part))) {
      output[key] = "[redacted]";
    } else {
      output[key] = redact(entry);
    }
  }
  return output;
}

export function logInfo(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level: "info", ts: new Date().toISOString(), event, ...(redact(fields) as object) }));
}

export function logError(event: string, fields: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ level: "error", ts: new Date().toISOString(), event, ...(redact(fields) as object) }));
}
