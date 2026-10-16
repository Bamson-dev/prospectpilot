import type { OutboundEmail } from "@/lib/email/types";

function wrap(base64: string) {
  return base64.replace(/(.{76})/g, "$1\r\n");
}

function encodeHeader(value: string) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function safeFileName(name: string) {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 100) || "attachment";
}

function safeHeaderName(name: string) {
  return /^[A-Za-z0-9-]{1,60}$/.test(name) ? name : null;
}

// Builds a multipart/mixed message with a base64 text body and base64 attachments.
export function buildMimeWithAttachments(message: OutboundEmail, boundary: string): string {
  const lines: string[] = [
    `From: ${message.fromName ? `${encodeHeader(message.fromName.replace(/[\r\n"<>]+/g, " ").trim())} <${message.from}>` : message.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
  ];
  if (message.replyTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.replyTo)) lines.push(`Reply-To: ${message.replyTo}`);
  for (const [name, value] of Object.entries(message.headers ?? {})) {
    const header = safeHeaderName(name);
    if (header) lines.push(`${header}: ${value.replace(/[\r\n]+/g, " ").trim()}`);
  }
  lines.push("MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "");
  lines.push(`--${boundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrap(Buffer.from(message.text, "utf8").toString("base64")));
  for (const attachment of message.attachments ?? []) {
    const fileName = safeFileName(attachment.fileName);
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType.replace(/[\r\n;]+/g, "")}; name="${fileName}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${fileName}"`,
      "",
      wrap(attachment.content.toString("base64")),
    );
  }
  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}
