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
    'Respond with ONLY a JSON object, no prose, of the shape: {"prompt": string, "options": string[] | null, "modelAnswer": string, "rubric": string | null}. The question must be answerable from the supplied input alone.',
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
 * Build the full prompt a remote model needs: the caller's instruction, the
 * structured input serialised as JSON context, and the output contract for the
 * purpose. An unknown purpose is a programmer error — refuse loudly rather
 * than sending an under-specified prompt.
 */
export function buildRemotePrompt(request: AiCompletionRequest): string {
  const contract = JSON_PURPOSES[request.purpose] ?? PROSE_PURPOSES[request.purpose];
  if (!contract) {
    throw new ValidationError(`Unknown AI purpose "${request.purpose}" — no remote prompt contract is defined for it.`);
  }
  const parts = [request.prompt.trim()];
  if (request.input !== undefined) {
    parts.push(`INPUT (JSON):\n\`\`\`json\n${JSON.stringify(request.input, null, 2)}\n\`\`\``);
  }
  parts.push(`OUTPUT REQUIREMENTS: ${contract}`);
  return parts.join("\n\n");
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
