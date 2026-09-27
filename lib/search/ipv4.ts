import https from "node:https";

export const IPV4_FAMILY = 4;

export function ipv4Get(target: URL, timeoutMs = 15000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        family: IPV4_FAMILY,
        servername: target.hostname,
        timeout: timeoutMs,
        headers: { Accept: "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("The IPv4 request timed out.")));
    req.end();
  });
}

export function describeGoogleDenial(body: string) {
  const redacted = body.replace(/AIza[0-9A-Za-z_-]+/g, "[key]").replace(/key=[^&\s"']+/gi, "key=[key]");
  let status = "";
  let reason = "";
  let message = "";
  try {
    const payload = JSON.parse(redacted) as {
      error?: { status?: string; message?: string; errors?: Array<{ reason?: string; message?: string }> };
    };
    status = payload.error?.status ?? "";
    reason = payload.error?.errors?.[0]?.reason ?? "";
    message = payload.error?.message ?? payload.error?.errors?.[0]?.message ?? "";
  } catch {
    return "permission";
  }
  const text = `${status} ${reason} ${message}`.toLowerCase();
  let kind = "permission";
  if (text.includes("ip address restriction") || text.includes("ipreferer") || reason === "ipRefererBlocked") kind = "API key restriction";
  else if (text.includes("has not been used") || text.includes("it is disabled") || reason === "accessNotConfigured") kind = "API not enabled";
  else if (text.includes("billing") || reason === "consumerInvalid") kind = "billing";
  else if (text.includes("quota") || text.includes("daily limit") || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") kind = "quota";
  else if ((text.includes("cx") || text.includes("custom search engine")) && text.includes("invalid")) kind = "invalid CX";
  else if (reason === "keyInvalid" || text.includes("api key not valid")) kind = "wrong API key/project";
  else if (/^[A-Z0-9_]+$/.test(status)) kind = status;
  const detail = message.replace(/\s+/g, " ").trim().slice(0, 220);
  return detail ? `${kind}: ${detail}` : kind;
}
