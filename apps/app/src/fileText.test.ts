import { describe, expect, it } from "vitest";
import { extractTextFromFile } from "./fileText";

/**
 * Client-side text extraction behind Content Studio's real file upload.
 * PDF extraction rides on pdfjs (exercised in the browser, not jsdom); the
 * paths with our own logic — plain text, the .docx ZIP/XML reader, and the
 * honest unsupported-type refusal — are covered here.
 */

/** Build a minimal valid ZIP holding one STORED (uncompressed) entry. */
function zipWithStoredEntry(name: string, content: string): Uint8Array {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const dataB = enc.encode(content);
  const local = new Uint8Array(30 + nameB.length + dataB.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); // local file header signature
  lv.setUint16(8, 0, true); // method: stored
  lv.setUint32(18, dataB.length, true); // compressed size
  lv.setUint32(22, dataB.length, true); // uncompressed size
  lv.setUint16(26, nameB.length, true);
  local.set(nameB, 30);
  local.set(dataB, 30 + nameB.length);

  const central = new Uint8Array(46 + nameB.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true); // central directory signature
  cv.setUint16(10, 0, true); // method
  cv.setUint32(20, dataB.length, true); // compressed size
  cv.setUint16(28, nameB.length, true);
  cv.setUint32(42, 0, true); // local header offset
  central.set(nameB, 46);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true); // entries on disk
  ev.setUint16(10, 1, true); // total entries
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true); // central dir offset

  const out = new Uint8Array(local.length + central.length + eocd.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(eocd, local.length + central.length);
  return out;
}

const DOCX_XML =
  '<?xml version="1.0"?><w:document><w:body>' +
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Adding fractions</w:t></w:r></w:p>' +
  "<w:p><w:r><w:t>Find a common denominator first, then add.</w:t></w:r></w:p>" +
  "<w:p><w:r><w:t>A &amp; B</w:t><w:t> together</w:t></w:r></w:p>" +
  "</w:body></w:document>";

describe("extractTextFromFile", () => {
  it("reads .txt and .md directly, deriving the title from the file name", async () => {
    const file = new File(["# Fractions\nCommon denominators."], "Year 8 Fractions.md", { type: "text/markdown" });
    const out = await extractTextFromFile(file);
    expect(out.title).toBe("Year 8 Fractions");
    expect(out.fileType).toBe("md");
    expect(out.text).toContain("Common denominators.");
  });

  it("extracts .docx text: headings become # sections, runs join, entities decode", async () => {
    const zip = zipWithStoredEntry("word/document.xml", DOCX_XML);
    const file = new File([zip as unknown as BlobPart], "syllabus.docx");
    const out = await extractTextFromFile(file);
    expect(out.fileType).toBe("docx");
    expect(out.text).toContain("# Adding fractions"); // heading style -> groundable section
    expect(out.text).toContain("Find a common denominator first, then add.");
    expect(out.text).toContain("A & B together"); // entity decoded, runs joined
  });

  it("refuses an unsupported extension honestly, naming what IS supported", async () => {
    const file = new File(["x"], "video.mp4");
    await expect(extractTextFromFile(file)).rejects.toThrow(/\.pdf, \.docx, \.txt, \.md/);
  });

  it("refuses a .docx with no document body rather than uploading emptiness", async () => {
    const zip = zipWithStoredEntry("word/other.xml", "<x/>");
    const file = new File([zip as unknown as BlobPart], "empty.docx");
    await expect(extractTextFromFile(file)).rejects.toThrow(/no readable document body/);
  });
});
