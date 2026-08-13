import type { AiCompletionRequest, PiiSubject } from "../../ports/aiProvider";

/**
 * Request-scoped PII masking for the AI service layer (NFR-PRV — no student or
 * teacher name needs to reach a model to get a good completion).
 *
 * The caller names the people it KNOWS are referenced (`piiValues`); every
 * variant of a person's name is replaced with one stable, readable pseudonym
 * ("Student A", "Teacher B") across `prompt` and every string inside `input`.
 * After the provider returns, tokens in the completion are substituted back to
 * each person's canonical name.
 *
 * The token → name map exists only as a local value inside one `run()` call:
 * it is never persisted, logged, or written to the audit trail — the audit
 * records only THAT masking happened (`piiMasked` count) and, separately, when
 * the model emitted a token that was never issued (`ai.mask.unresolved`).
 *
 * Everything here is pure and unit-tested; the service layer stays thin.
 */

export interface MaskResult {
  /** The request the provider may see: names replaced, `piiValues` stripped. */
  masked: AiCompletionRequest;
  /** token → canonical real value. Request-scoped; NEVER persist or log. */
  map: Map<string, string>;
  /** How many subjects actually had a name replaced somewhere (auditable). */
  maskedCount: number;
}

const ROLE_LABEL: Record<PiiSubject["role"], string> = {
  student: "Student",
  teacher: "Teacher",
  parent: "Parent",
};

/** 0 → "A", 25 → "Z", 26 → "AA" … stable, readable suffixes. */
function tokenSuffix(index: number): string {
  let s = "";
  let i = index + 1;
  while (i > 0) {
    i -= 1;
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26);
  }
  return s;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Variants shorter than this are skipped — replacing them would corrupt prose. */
const MIN_VARIANT_LENGTH = 2;

/**
 * Mask a request. No-op (empty map) unless `containsStudentData` is true AND
 * the caller supplied at least one usable name variant.
 *
 * Matching is word-bounded and exact-case: "Ada" never touches "Adapt", and
 * "Mark" the person never touches "mark" the verb. Longer variants win first,
 * so "Sana Student" masks as one token before "Sana" alone could split it.
 */
export function maskRequest(request: AiCompletionRequest): MaskResult {
  const subjects = (request.piiValues ?? [])
    .map((s) => ({ ...s, values: s.values.map((v) => v.trim()).filter((v) => v.length >= MIN_VARIANT_LENGTH) }))
    .filter((s) => s.values.length > 0);

  if (!request.containsStudentData || subjects.length === 0) {
    return { masked: request, map: new Map(), maskedCount: 0 };
  }

  const counters: Record<PiiSubject["role"], number> = { student: 0, teacher: 0, parent: 0 };
  const map = new Map<string, string>();
  const pairs: { variant: string; token: string }[] = [];
  for (const subject of subjects) {
    const token = `${ROLE_LABEL[subject.role]} ${tokenSuffix(counters[subject.role]++)}`;
    map.set(token, subject.values[0]); // canonical form restored on unmask
    for (const variant of subject.values) pairs.push({ variant, token });
  }
  pairs.sort((a, b) => b.variant.length - a.variant.length);

  const replacedTokens = new Set<string>();
  const maskString = (text: string): string => {
    let out = text;
    for (const { variant, token } of pairs) {
      const next = out.replace(new RegExp(`\\b${escapeRegExp(variant)}\\b`, "g"), token);
      if (next !== out) replacedTokens.add(token);
      out = next;
    }
    return out;
  };
  const maskValue = (value: unknown): unknown => {
    if (typeof value === "string") return maskString(value);
    if (Array.isArray(value)) return value.map(maskValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, maskValue(v)]));
    }
    return value;
  };

  const masked: AiCompletionRequest = {
    ...request,
    prompt: maskString(request.prompt),
    input: maskValue(request.input),
    piiValues: undefined, // the provider must never see the real values
  };
  return { masked, map, maskedCount: replacedTokens.size };
}

export interface UnmaskResult {
  text: string;
  /**
   * Token-shaped strings that remain AFTER substitution — pseudonyms the model
   * emitted that were never issued (e.g. a hallucinated "Student Z"). Left in
   * the text untouched; the caller flags them rather than guessing.
   */
  unresolvedTokens: string[];
}

/**
 * Restore real names in a completion. Token matching is case-INSENSITIVE
 * (models drift casing: "student a"), and the word boundary after the suffix
 * handles possessives: "Student A's" → "Sana's". Longer tokens are replaced
 * first so "Student AA" is never split by "Student A".
 */
export function unmaskText(text: string, map: Map<string, string>): UnmaskResult {
  if (map.size === 0) return { text, unresolvedTokens: [] };
  let out = text;
  for (const token of [...map.keys()].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, "gi"), map.get(token)!);
  }
  const unresolvedTokens = [...new Set(out.match(/\b(?:Student|Teacher|Parent) [A-Z]{1,2}\b/g) ?? [])];
  return { text: out, unresolvedTokens };
}
