import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import JSZip from "jszip";

export async function renderPdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = wrap(text, 90);
  let page = doc.addPage([612, 792]);
  let y = 750;
  for (const line of lines) {
    if (y < 48) {
      page = doc.addPage([612, 792]);
      y = 750;
    }
    page.drawText(line, { x: 48, y, size: 11, font });
    y -= 16;
  }
  return Buffer.from(await doc.save());
}

export async function renderDocx(text: string) {
  const doc = new Document({
    sections: [{
      children: text.split("\n").map((line) => new Paragraph({ children: [new TextRun(line || " ")] })),
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export function checksum(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function pdfLooksReadable(bytes: Buffer, expected: string) {
  if (!bytes.subarray(0, 5).toString("latin1").startsWith("%PDF")) return false;
  const raw = decodePdfText(pdfPlainText(bytes));
  return expected.split(/\s+/).filter((word) => word.length > 1).every((word) => raw.includes(word));
}

function decodePdfText(raw: string) {
  return raw.replace(/<([0-9A-Fa-f]+)>/g, (_match, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
}

function pdfPlainText(bytes: Buffer) {
  const chunks = [bytes.toString("latin1")];
  let cursor = 0;
  const marker = Buffer.from("stream");
  while (cursor < bytes.length) {
    const start = bytes.indexOf(marker, cursor);
    if (start < 0) break;
    let body = start + marker.length;
    if (bytes[body] === 13) body += 1;
    if (bytes[body] === 10) body += 1;
    const end = bytes.indexOf(Buffer.from("endstream"), body);
    if (end < 0) break;
    try {
      chunks.push(inflateSync(bytes.subarray(body, end)).toString("latin1"));
    } catch {
      chunks.push(bytes.subarray(body, end).toString("latin1"));
    }
    cursor = end + 9;
  }
  return chunks.join("\n");
}

export async function docxContains(bytes: Buffer, expected: string) {
  if (bytes.subarray(0, 2).toString("latin1") !== "PK") return false;
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  return Boolean(xml?.includes(expected));
}

function wrap(text: string, width: number) {
  const output: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/[^\x20-\x7E]/g, " ");
    if (!line) {
      output.push("");
      continue;
    }
    let rest = line;
    while (rest.length > width) {
      output.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    output.push(rest);
  }
  return output;
}
