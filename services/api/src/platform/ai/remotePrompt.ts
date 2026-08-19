import { ServiceUnavailableError, ValidationError } from "../../domain/errors";
import type { AiCompletionRequest } from "../../ports/aiProvider";

/**
 * Prompt assembly + response extraction for the REMOTE (Bedrock) provider.
 *
 * The port's contract drifted as the app grew: callers put the instruction in
 * `prompt` and all real content (grounding sources, topic, term…) in `input`,
 * which only the local deterministic provider read. A remote model must see
 * both — and must be held to the same OUTPUT shapes the local provider emits,
 * because services parse `completion.text` (JSON for classification and
 * assessment generation, prose elsewhere).
 *
 * Everything here is pure and unit-tested; BedrockProvider stays a thin
 * transport around it.
 */

/** Purposes whose completion text must be a single JSON object. */
const JSON_PURPOSES: Record<string, string> = {
  "content.classify":
    'Respond with ONLY a JSON object, no prose, of the shape: {"subject": string, "year": number, "topic": string, "outcome": string, "difficulty": "easy"|"medium"|"hard", "confidence": number between 0 and 1}.',
  "assessment.generate":
    'Respond with ONLY a JSON object, no prose, of the shape: {"prompt": string, "options": string[] | null, "modelAnswer": string, "rubric": string | null}. ' +
    "The question must be answerable from the supplied input alone, must assess the named skill at the stated difficulty, and must test the SUBJECT MATTER a student is learning. " +
    "Never quiz the document's own apparatus — copyright, licensing, publication details, tables of contents, acknowledgements — even when the supplied extract contains such text; draw on whatever in the extract genuinely teaches the skill.",
  "assessment.grade":
    'Respond with ONLY a JSON object, no prose, of the shape: {"results": [{"questionId": string, "score": number between 0 and 1, "correct": boolean}], "overallScore": number between 0 and 1}. ' +
    "For each question in the supplied INPUT, grade the studentAnswer against its modelAnswer (or its rubric, for extended_response/scenario questions with no single correct string) — score partial credit fairly rather than only exact matches. " +
    "overallScore is the mean of every per-question score. Include exactly one result per input question, in the same order.",
  "curriculum.draft":
    'Respond with ONLY a JSON object, no prose, of the shape: {"strands": [{"label": string, "skills": string[]}]}. ' +
    "You are outlining a curriculum from the supplied syllabus text ALONE — use its own strand/outcome headings and the skills it actually describes. " +
    "Do NOT add strands or skills from your own knowledge of the subject, even if you believe the real syllabus contains them: an unreviewed invention here becomes what a teacher is told the curriculum is. " +
    "Each skill must be a short teachable statement (under 90 characters) that a student could demonstrate. Omit administrative sections (copyright, acknowledgement of country, glossary, assessment advice).",
};

/** Prose purposes and the guardrails their output must respect. */
const PROSE_PURPOSES: Record<string, string> = {
  "agent.generate":
    "Respond with the draft text only. Ground every claim strictly in the supplied sources; do not invent material beyond them.",
  "help.hint":
    "Respond with a short hint only. NEVER state or imply the final answer; nudge the student toward their own next step, using only the supplied grounding.",
  "parent.summary":
    "Respond with a short plain-language summary only. Describe what was observed in everyday words; never use clinical or diagnostic terms, and never include internal codes or identifiers.",
};

export function isKnownRemotePurpose(purpose: string): boolean {
  return purpose in JSON_PURPOSES || purpose in PROSE_PURPOSES;
}

/**
 * A short, purpose-INDEPENDENT preamble shared by every remote call — the one
 * invariant every purpose already enforces individually (never invent beyond
 * the supplied grounding). Stable across every request regardless of purpose,
 * so it belongs in the cacheable prefix alongside the per-purpose contract
 * (see buildRemoteSystemPrompt) rather than in the per-call user turn.
 */
const SHARED_SYSTEM_PREAMBLE =
  "You are a grounded assistant for Pathfinder, an Australian schools platform. " +
  "Answer strictly from the supplied INPUT and grounding sources — never invent facts, " +
  "names, or content beyond what is given. If the supplied material is insufficient to " +
  "satisfy the OUTPUT REQUIREMENTS below, say so plainly rather than fabricating an answer.";

/**
 * The STABLE half of a remote prompt: the shared preamble plus the purpose's
 * output contract. Identical for every call sharing the same purpose, which
 * makes it the correct system-prompt / cache_control boundary — see
 * AnthropicProvider. An unknown purpose is a programmer error — refuse loudly
 * rather than sending an under-specified prompt.
 */
export function buildRemoteSystemPrompt(purpose: string): string {
  const contract = JSON_PURPOSES[purpose] ?? PROSE_PURPOSES[purpose];
  if (!contract) {
    throw new ValidationError(`Unknown AI purpose "${purpose}" — no remote prompt contract is defined for it.`);
  }
  return `${SHARED_SYSTEM_PREAMBLE}\n\nOUTPUT REQUIREMENTS: ${contract}`;
}

/**
 * The VARYING half of a remote prompt: the caller's instruction plus the
 * structured input serialised as JSON context. Different on every call, so it
 * belongs after the cached system prefix, never inside it.
 */
export function buildRemoteUserPrompt(request: AiCompletionRequest): string {
  const parts = [request.prompt.trim()];
  if (request.input !== undefined) {
    parts.push(`INPUT (JSON):\n\`\`\`json\n${JSON.stringify(request.input, null, 2)}\n\`\`\``);
  }
  return parts.join("\n\n");
}

/**
 * Build the full prompt a remote model needs, as a single string — the shape
 * BedrockProvider sends as one user turn (Bedrock's older invoke API has no
 * separate cacheable system block worth splitting out here). Providers that
 * DO support prompt caching (AnthropicProvider) should call
 * buildRemoteSystemPrompt + buildRemoteUserPrompt separately instead, so the
 * stable half can be marked cache_control and the varying half can't.
 */
export function buildRemotePrompt(request: AiCompletionRequest): string {
  return [buildRemoteSystemPrompt(request.purpose), buildRemoteUserPrompt(request)].join("\n\n");
}

/**
 * Validate + normalise a remote completion. JSON purposes must yield a
 * parseable JSON object (models often wrap it in a code fence — unwrap it);
 * prose purposes must yield non-empty text. Anything else raises, because a
 * silently-empty completion downstream becomes an empty draft or a failed
 * parse far from its cause.
 */
export function extractCompletionText(purpose: string, raw: string): string {
  const text = (raw ?? "").trim();
  if (!text) {
    throw new ServiceUnavailableError(
      `The AI provider returned an empty completion for "${purpose}".`,
      "AI_RESPONSE_MALFORMED",
    );
  }
  if (!(purpose in JSON_PURPOSES)) return text;

  // Unwrap a ```json fence if present, else take the outermost {...} span.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    return JSON.stringify(parsed);
  } catch {
    throw new ServiceUnavailableError(
      `The AI provider returned a malformed completion for "${purpose}" (expected a JSON object).`,
      "AI_RESPONSE_MALFORMED",
    );
  }
}
