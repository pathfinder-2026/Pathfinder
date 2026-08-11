/**
 * Milestone 7 — Ask for Help domain (FR-STU-002 / FR-SAG-001 / FR-SAG-002).
 *
 * The task-gated tutor. Safety is STRUCTURAL, not prompt-based:
 *   - The assessment-in-progress lockout is decided by the SERVICE from task/attempt
 *     state (see AskForHelpService), never by asking the model.
 *   - The tutor is only ever given the task's approved-content grounding and asked
 *     for a HINT; it is never given "the answer", so it cannot leak one.
 *   - Off-topic redirection, direct-answer-extraction resistance, the safety filter
 *     and the safeguarding classifier are DETERMINISTIC functions here, so they are
 *     testable against an adversarial suite and independent of any prompt wording.
 *
 * These behaviours are risk reduction backed by logging/monitoring — documented as
 * such, not as absolute guarantees (v1.3 definition of done).
 */

export type HelpMessageRole = "student" | "assistant";

/** How the assistant handled a student message. */
export type HelpResponseKind =
  | "hint"
  | "worked_example"
  | "declined_offtopic"
  | "declined_direct_answer"
  | "blocked_safety"
  | "safeguarding";

export interface HelpSession {
  id: string;
  schoolId: string;
  studentId: string;
  taskId: string;
  /** The assigning Teacher — the only role who may read this transcript. */
  teacherId: string;
  createdAt: string;
}

export interface HelpMessage {
  id: string;
  sessionId: string;
  role: HelpMessageRole;
  text: string;
  kind: HelpResponseKind;
  createdAt: string;
}

export type HelpUnavailableReason =
  | "assessment_in_progress"
  | "not_homework_or_practice"
  | "safeguarding_not_configured";

export interface HelpResponse {
  available: true;
  kind: HelpResponseKind;
  message: string;
}
export interface HelpUnavailable {
  available: false;
  reason: HelpUnavailableReason;
  message: string;
}
export type HelpResult = HelpResponse | HelpUnavailable;

// ---- deterministic classifiers ----

// Disclosure phrasings, deliberately biased to personal ("me"/"my"/"I") forms to
// catch a child disclosing harm while limiting false positives on academic text.
// This is monitored risk reduction, not an absolute guarantee (see file header).
const SAFEGUARDING = [
  "hurt myself", "harm myself", "self harm", "self-harm", "kill myself", "want to die",
  "end my life", "suicid", "someone is hurting me", "being hurt", "hurting me",
  "abused", "abuse at home", "abuses me", "abusing me", "abuse me",
  "hits me", "hit me", "hitting me", "beats me", "beat me", "beaten",
  "neglected", "neglecting me", "starving me", "starve me",
  "unsafe at home", "not safe at home", "scared to go home", "afraid to go home",
  "afraid of my", "scared of my", "run away from home", "touched me", "touches me",
];

const UNSAFE = [
  "make a weapon", "make a bomb", "how to hurt someone", "kill him", "kill her", "kill them",
  "buy drugs", "explosive",
];
// Diagnostic-claim solicitations (NFR-SAF-001: the assistant avoids diagnostic claims).
const DIAGNOSTIC = ["do i have", "am i autistic", "am i depressed", "have adhd", "diagnose"];

const DIRECT_ANSWER = [
  "give me the answer", "give the answer", "show me the answer", "tell me the answer",
  "what is the answer", "what's the answer", "the answer is", "just tell me", "just give me",
  "solve it for me", "solve this for me", "do it for me", "do my homework", "complete it for me",
  "write it for me", "write the answer", "final answer", "the solution", "solution to this",
  "answer key", "correct answer", "right answer", "give the solution",
  // extraction / jailbreak framings (persona, role-play, multi-turn, coercion)
  "pretend", "ignore your", "ignore previous", "ignore the rules", "you are now", "act as",
  "roleplay", "role-play", "role play", "as my friend", "for a friend", "my teacher said you should give",
  "just this once", "i won't tell", "between us", "override", "developer mode", "dan mode",
  "no rules", "without the rules", "bypass",
];

const OFF_TOPIC = [
  "capital of", "football", "soccer", "movie", "netflix", "video game", "fortnite", "minecraft",
  "weather", "tell me a joke", "tiktok", "celebrity", "who won", "recipe", "dinosaur", "pokemon",
  "song", "footy", "world cup",
];

function contains(text: string, needles: string[]): boolean {
  const t = text.toLowerCase();
  return needles.some((n) => t.includes(n));
}

/** Words (len > 3) shared between a message and the task's topic keywords. */
function sharesTaskKeyword(text: string, taskKeywords: string[]): boolean {
  const t = text.toLowerCase();
  return taskKeywords.some((k) => k.length > 3 && t.includes(k.toLowerCase()));
}

export type HelpClassification =
  | "safeguarding" | "blocked_safety" | "declined_direct_answer" | "declined_offtopic" | "proceed";

/**
 * Priority-ordered classification of a student message. Safety first (safeguarding,
 * then unsafe/diagnostic), then extraction resistance, then off-topic, else proceed
 * to a grounded hint.
 */
export function classifyHelpMessage(text: string, taskKeywords: string[]): HelpClassification {
  if (contains(text, SAFEGUARDING)) return "safeguarding";
  if (contains(text, UNSAFE) || contains(text, DIAGNOSTIC)) return "blocked_safety";
  if (contains(text, DIRECT_ANSWER)) return "declined_direct_answer";
  // Off-topic: an unrelated-subject signal with no overlap with this task's topic.
  if (contains(text, OFF_TOPIC) && !sharesTaskKeyword(text, taskKeywords)) return "declined_offtopic";
  return "proceed";
}

/** Tokenise a task title/topic into keywords for the off-topic overlap check. */
export function taskKeywords(...parts: (string | null | undefined)[]): string[] {
  return parts
    .filter((p): p is string => Boolean(p))
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
}
