import type { StoredObject } from "./storagePort";

export interface ExtractedSection {
  heading: string;
  text: string;
}

export type ExtractionResult =
  | { kind: "text"; sections: ExtractedSection[] }
  | { kind: "no_text" } // scanned / image-only → needs OCR
  | { kind: "error" }; // corrupted / unreadable

/**
 * Text/structure extraction port (FR-ING-001/002). Production uses a real
 * parser/OCR service (e.g. Amazon Textract, in-region). The default in-memory
 * extractor derives sections from the stored text: lines beginning with "#" are
 * headings; following lines are that section's body.
 */
export interface TextExtractorPort {
  extract(object: StoredObject): ExtractionResult;
}

export class InMemoryTextExtractor implements TextExtractorPort {
  extract(object: StoredObject): ExtractionResult {
    if (object.corrupt) return { kind: "error" };
    if (object.scanned || !object.text || object.text.trim() === "") {
      return { kind: "no_text" };
    }
    return { kind: "text", sections: parseSections(object.text) };
  }
}

/** Above this, a single section is split into parts so it can ground more than one question. */
const MAX_SECTION_CHARS = 2_500;

/**
 * Split a document into groundable sections.
 *
 * Markdown headings win when present. Real PDFs have none, though — a 50k-char
 * NESA syllabus arrived as ONE section called "Introduction", which capped its
 * grounding capacity at a single question no matter how much curriculum it
 * contained. So when markdown yields nothing, heading-LIKE lines are detected,
 * and any section that is still oversized is divided into parts.
 */
function parseSections(text: string): ExtractedSection[] {
  // Presence of ANY markdown heading decides the strategy — not how many
  // sections it yields. Keying off the count discarded a real "# Outcomes"
  // heading whenever a document had exactly one.
  const hasMarkdownHeadings = /^\s*#/m.test(text);
  const sections = hasMarkdownHeadings ? parseMarkdownSections(text) : parseProseSections(text);
  return sections.flatMap(splitOversized);
}

function parseMarkdownSections(text: string): ExtractedSection[] {
  const sections: ExtractedSection[] = [];
  let current: ExtractedSection | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      if (current) sections.push(current);
      current = { heading: line.replace(/^#+\s*/, ""), text: "" };
    } else {
      if (!current) current = { heading: "Introduction", text: "" };
      current.text += (current.text ? " " : "") + line;
    }
  }
  if (current) sections.push(current);
  return sections;
}

/**
 * Headings in extracted prose: a short standalone line that doesn't read as a
 * sentence, or a numbered/stage-style label. Deliberately conservative — a
 * missed heading only costs granularity, while a false one would title a
 * section with a random sentence fragment.
 */
function looksLikeHeading(line: string, next: string | undefined): boolean {
  if (line.length < 3 || line.length > 80) return false;
  if (/[.;:,]$/.test(line)) return false; // reads as a sentence
  if (/^\d+$/.test(line)) return false; // a bare page number
  const numbered = /^(\d+(\.\d+)*|[A-Z]\.|stage\s+\d+)\s+\S/i.test(line);
  const titleish = /^[A-Z]/.test(line) && line.split(/\s+/).length <= 10;
  // A heading introduces something: the next line should be body text.
  return (numbered || titleish) && !!next && next.length > line.length;
}

function parseProseSections(text: string): ExtractedSection[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const sections: ExtractedSection[] = [];
  let current: ExtractedSection = { heading: "Introduction", text: "" };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (looksLikeHeading(line, lines[i + 1])) {
      if (current.text) sections.push(current);
      current = { heading: line, text: "" };
    } else {
      current.text += (current.text ? " " : "") + line;
    }
  }
  if (current.text) sections.push(current);
  return sections;
}

/** Divide a long section into parts, so document size drives grounding capacity. */
function splitOversized(section: ExtractedSection): ExtractedSection[] {
  if (section.text.length <= MAX_SECTION_CHARS) return [section];
  const parts: ExtractedSection[] = [];
  const words = section.text.split(/\s+/);
  let buffer = "";
  for (const word of words) {
    if (buffer.length + word.length + 1 > MAX_SECTION_CHARS) {
      parts.push({ heading: `${section.heading} (part ${parts.length + 1})`, text: buffer });
      buffer = word;
    } else {
      buffer += (buffer ? " " : "") + word;
    }
  }
  if (buffer) parts.push({ heading: `${section.heading} (part ${parts.length + 1})`, text: buffer });
  return parts;
}
