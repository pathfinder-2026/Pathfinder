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

function parseSections(text: string): ExtractedSection[] {
  const lines = text.split(/\r?\n/);
  const sections: ExtractedSection[] = [];
  let current: ExtractedSection | null = null;
  for (const raw of lines) {
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
