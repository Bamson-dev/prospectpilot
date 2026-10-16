import { describe, expect, it } from "vitest";
import { buildMimeWithAttachments } from "@/lib/email/mime";

describe("buildMimeWithAttachments", () => {
  const message = {
    from: "ada@example.com",
    fromName: "Ada Lovelace",
    to: "careers@northwind.io",
    subject: "Application for Growth Lead - Ada Lovelace",
    text: "Hello",
    attachments: [
      { fileName: "CV Ada.pdf", mimeType: "application/pdf", content: Buffer.from("cv-bytes") },
      { fileName: "Letter.pdf", mimeType: "application/pdf", content: Buffer.from("letter-bytes") },
    ],
    headers: { "X-ProspectPilot-Application": "abc123", "Bad Header": "x" },
  };

  it("builds a multipart message with both attachments", () => {
    const mime = buildMimeWithAttachments(message, "BOUNDARY");
    expect(mime).toContain('Content-Type: multipart/mixed; boundary="BOUNDARY"');
    expect(mime).toContain(Buffer.from("cv-bytes").toString("base64"));
    expect(mime).toContain(Buffer.from("letter-bytes").toString("base64"));
    expect(mime).toContain('name="CV_Ada.pdf"');
    expect(mime).toContain("--BOUNDARY--");
  });

  it("keeps custom headers and drops unsafe header names", () => {
    const mime = buildMimeWithAttachments(message, "BOUNDARY");
    expect(mime).toContain("X-ProspectPilot-Application: abc123");
    expect(mime).not.toContain("Bad Header");
  });

  it("encodes non-ascii subjects", () => {
    const mime = buildMimeWithAttachments({ ...message, subject: "Bewerbung für Growth" }, "B");
    expect(mime).toContain("Subject: =?UTF-8?B?");
  });
});
