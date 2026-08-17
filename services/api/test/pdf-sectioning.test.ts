import { describe, expect, it } from "vitest";
import { InMemoryTextExtractor } from "../src/ports/textExtractorPort";

const extractor = new InMemoryTextExtractor();
const extract = (text: string) => {
  const result = extractor.extract({ text } as never);
  if (result.kind !== "text") throw new Error(`expected text, got ${result.kind}`);
  return result.sections;
};

/**
 * Task #16 — a real NESA PDF extracted as ONE ~50k-character section called
 * "Introduction", because sectioning only split on markdown headings and a PDF
 * has none. Grounding capacity is one question per section, so an entire
 * syllabus could ground exactly one question.
 */
describe("Sectioning documents that have no markdown headings", () => {
  it("still splits markdown on its headings (unchanged behaviour)", () => {
    const sections = extract("# Fractions\nAdd and subtract fractions.\n# Decimals\nConvert decimals.");
    expect(sections.map((s) => s.heading)).toEqual(["Fractions", "Decimals"]);
  });

  it("finds heading-like lines in extracted PDF prose", () => {
    const sections = extract([
      "Design and Production Skills",
      "Students identify and explore needs, opportunities and wants for design projects across a range of contexts.",
      "Material Technologies",
      "Students select and justify appropriate materials for a given purpose, considering sustainability and cost.",
    ].join("\n"));
    expect(sections.map((s) => s.heading)).toEqual(["Design and Production Skills", "Material Technologies"]);
    expect(sections[0]!.text).toMatch(/identify and explore needs/);
  });

  it("recognises numbered and stage-style headings", () => {
    const sections = extract([
      "1.2 Working Scientifically",
      "Students plan and conduct fair investigations, controlling variables where practical and appropriate.",
      "Stage 4 Outcomes",
      "Students describe the action of forces in everyday situations and explain their observable effects.",
    ].join("\n"));
    expect(sections.map((s) => s.heading)).toEqual(["1.2 Working Scientifically", "Stage 4 Outcomes"]);
  });

  it("a heading-less wall of text still grounds MORE THAN ONE question", () => {
    // The failure case: one continuous blob, as a PDF of prose extracts.
    const blob = "The syllabus describes what students learn and how they demonstrate it. ".repeat(200);
    const sections = extract(blob);
    expect(sections.length).toBeGreaterThan(1);
    // Every part carries real text from the document — nothing is invented.
    expect(sections.every((s) => s.text.trim().length > 0)).toBe(true);
    expect(sections.map((s) => s.text).join(" ")).toContain("students learn");
    // Parts are labelled so a teacher can tell where they came from.
    expect(sections[1]!.heading).toMatch(/part 2/i);
  });

  it("does not mistake sentences for headings", () => {
    const sections = extract([
      "This document sets out the requirements for the course.",
      "It should be read alongside the assessment guide published separately by the authority.",
    ].join("\n"));
    // Both lines end as prose, so neither becomes a heading.
    expect(sections).toHaveLength(1);
    expect(sections[0]!.heading).toBe("Introduction");
  });

  it("splits an oversized section so capacity scales with the document", () => {
    const long = "# Outcomes\n" + "Students investigate and evaluate solutions to identified problems. ".repeat(150);
    const sections = extract(long);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((s) => s.text.length <= 2_500)).toBe(true);
    expect(sections[0]!.heading).toMatch(/^Outcomes/);
  });
});
