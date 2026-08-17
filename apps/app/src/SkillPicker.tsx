import { useEffect, useMemo, useState } from "react";
import type { SkillNodeRow, SkillsResult } from "./api";
import { Field } from "./components";

/** Only leaf teaching targets are selectable — never a subject/strand heading. */
const TEACHABLE = new Set(["skill", "subskill"]);

interface TeachableNode {
  node: SkillNodeRow;
  subjectId: string;
  /** Ancestor labels, subject first, excluding the node itself. */
  path: string[];
}

/**
 * Year → Subject → Concept, the way a teacher describes their own timetable.
 *
 * The graph has always been hierarchical (subject/strand/outcome/topic/concept/
 * skill/subskill, linked by parentId) but every screen flattened it into one
 * dropdown, so "Mathematics" itself was selectable as a skill and every strand's
 * skills sat in one list. A first pass then led with "Strand" — curriculum
 * filing jargon, with no year or subject above it to anchor the choice.
 *
 * Three pickers are built on the same Year/Subject scope:
 *   - SkillPicker      — one concept (tailored drafts, peer tests, insights)
 *   - SkillMultiPicker — several concepts (#19: a unit spans more than one)
 *   - SubjectPicker    — the subject itself (#19: where material is now filed)
 *
 * Each level pre-selects and locks when the school offers only one option, so a
 * single-curriculum school still sees the same hierarchy without extra clicks.
 */

/** The Year/Subject scope every picker shares. */
function useCurriculumScope(skills: SkillsResult | null) {
  const [year, setYear] = useState<string>("");
  const [subjectId, setSubjectId] = useState("");

  const { subjects, teachable } = useMemo(() => {
    const nodes: SkillNodeRow[] = skills?.signedOff ? skills.nodes : [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    /** Walk parentId to the root; `seen` guards a malformed graph from looping. */
    const chainOf = (id: string): SkillNodeRow[] => {
      const chain: SkillNodeRow[] = [];
      const seen = new Set<string>();
      let current = byId.get(id);
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        chain.unshift(current);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return chain;
    };
    return {
      subjects: nodes.filter((n) => n.type === "subject"),
      teachable: nodes.filter((n) => TEACHABLE.has(n.type)).map((n): TeachableNode => {
        const chain = chainOf(n.id);
        return {
          node: n,
          subjectId: chain.find((c) => c.type === "subject")?.id ?? "",
          path: chain.slice(0, -1).map((c) => c.label),
        };
      }),
    };
  }, [skills]);

  const years = [...new Set(subjects.map((s) => s.yearLevel).filter((y): y is number => y != null))].sort((a, b) => a - b);
  const activeYear = year || (years.length === 1 ? String(years[0]) : "");
  const subjectsForYear = subjects.filter(
    (s) => !activeYear || s.yearLevel == null || String(s.yearLevel) === activeYear,
  );
  const activeSubject = subjectId || (subjectsForYear.length === 1 ? subjectsForYear[0]!.id : "");
  const visible = teachable.filter((t) => !activeSubject || t.subjectId === activeSubject);

  return { years, activeYear, setYear, subjectsForYear, activeSubject, setSubjectId, visible };
}

type Scope = ReturnType<typeof useCurriculumScope>;

/** The Year and Subject selects, identical wherever a curriculum is narrowed. */
function ScopeFields({ scope, idPrefix, disabled, onScopeChange, subjectHint }: {
  scope: Scope;
  idPrefix: string;
  disabled?: boolean;
  /** Fired when the teacher changes Year or Subject — clears any selection below. */
  onScopeChange: () => void;
  subjectHint?: string;
}) {
  return (
    <>
      {/* 1 — Year. Shown whenever any curriculum records one; a school with a
          single year sees it locked rather than hidden, so the hierarchy the
          teacher navigates is the same everywhere. */}
      {scope.years.length > 0 && (
        <Field label="Year" htmlFor={`${idPrefix}-year`}>
          <select
            id={`${idPrefix}-year`} className="select" value={scope.activeYear}
            disabled={disabled || scope.years.length <= 1}
            onChange={(e) => { scope.setYear(e.target.value); scope.setSubjectId(""); onScopeChange(); }}
          >
            {scope.years.length > 1 && <option value="">All years</option>}
            {scope.years.map((y) => <option key={y} value={String(y)}>Year {y}</option>)}
          </select>
        </Field>
      )}

      {/* 2 — Subject. */}
      <Field label="Subject" htmlFor={`${idPrefix}-subject`} hint={subjectHint}>
        <select
          id={`${idPrefix}-subject`} className="select" value={scope.activeSubject}
          disabled={disabled || scope.subjectsForYear.length <= 1}
          onChange={(e) => { scope.setSubjectId(e.target.value); onScopeChange(); }}
        >
          {scope.subjectsForYear.length > 1 && <option value="">All subjects</option>}
          {scope.subjectsForYear.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          {scope.subjectsForYear.length === 0 && <option value="">No curriculum signed off yet</option>}
        </select>
      </Field>
    </>
  );
}

/** The shared "nothing to pick from yet" state. */
function NotSignedOff({ label, idPrefix }: { label: string; idPrefix: string }) {
  return (
    <Field label={label} htmlFor={`${idPrefix}-skill`}>
      <select id={`${idPrefix}-skill`} className="select" disabled>
        <option>Skill graph not signed off yet</option>
      </select>
    </Field>
  );
}

const groundedCount = (t: TeachableNode, capacity?: Record<string, number>) => capacity?.[t.node.id] ?? 0;

function optionLabel(t: TeachableNode, capacity?: Record<string, number>, countNoun?: string): string {
  const code = t.node.code ? ` (${t.node.code})` : "";
  const count = capacity && countNoun && groundedCount(t, capacity) > 0
    ? ` — up to ${groundedCount(t, capacity)} ${countNoun}`
    : "";
  return `${t.node.label}${code}${count}`;
}

/**
 * Grouping always carries the most actionable dimension available: whether a
 * concept can be used at all when we know that, otherwise where it sits — its
 * immediate parent, kept under the strand (the full chain is up to five levels,
 * unreadable as a group heading, so it goes in the hint below instead).
 */
function conceptGroups(
  visible: TeachableNode[],
  capacity?: Record<string, number>,
): { label: string; items: TeachableNode[]; disabled?: boolean }[] {
  if (capacity) {
    return [
      { label: "Ready to use", items: visible.filter((t) => groundedCount(t, capacity) > 0) },
      { label: "No approved material yet", items: visible.filter((t) => groundedCount(t, capacity) === 0), disabled: true },
    ];
  }
  const placeOf = (t: TeachableNode) => {
    const withoutSubject = t.path.slice(1);
    const parent = withoutSubject.at(-1) ?? "Skills";
    const strand = withoutSubject[0];
    return strand && strand !== parent ? `${strand} → ${parent}` : parent;
  };
  return Object.entries(
    visible.reduce<Record<string, TeachableNode[]>>((acc, t) => {
      (acc[placeOf(t)] ??= []).push(t);
      return acc;
    }, {}),
  ).map(([groupLabel, items]) => ({ label: groupLabel, items }));
}

/**
 * One concept. When `capacity` is supplied, concepts the approved pool can't
 * ground are disabled rather than merely offered-then-refused (the
 * empty-generate trap).
 */
export function SkillPicker({
  skills, value, onChange, capacity, countNoun, label = "Concept", hint, idPrefix, disabled,
}: {
  skills: SkillsResult | null;
  value: string;
  onChange: (nodeId: string) => void;
  /** Per-node grounding capacity. Given → ungrounded skills are disabled. */
  capacity?: Record<string, number>;
  /** e.g. "questions" — renders "up to N questions" beside each ready skill. */
  countNoun?: string;
  /** Field label for the final level — "Concept" in the teacher's language. */
  label?: string;
  hint?: string;
  idPrefix: string;
  disabled?: boolean;
}) {
  const scope = useCurriculumScope(skills);
  const groups = conceptGroups(scope.visible, capacity);
  const selected = scope.visible.find((t) => t.node.id === value);

  if (skills && !skills.signedOff) return <NotSignedOff label={label} idPrefix={idPrefix} />;

  return (
    <>
      <ScopeFields scope={scope} idPrefix={idPrefix} disabled={disabled} onScopeChange={() => onChange("")} />

      {/* 3 — Concept. Topic areas group the list rather than adding a control:
          the teacher picks what they teach, not how the syllabus is filed. */}
      <Field label={label} htmlFor={`${idPrefix}-skill`} hint={selected ? selected.path.join(" → ") : hint}>
        <select
          id={`${idPrefix}-skill`} className="select" value={value} disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose a concept…</option>
          {groups.filter((g) => g.items.length > 0).map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((t) => (
                <option key={t.node.id} value={t.node.id} disabled={g.disabled}>
                  {optionLabel(t, capacity, countNoun)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
    </>
  );
}

/**
 * Several concepts (#19). A lesson or a term's assessment normally covers more
 * than one concept, and forcing one meant the teacher either generated three
 * separate drafts or quietly picked the closest.
 *
 * Checkboxes rather than a `<select multiple>`: multi-select on a native select
 * is undiscoverable (ctrl-click) and unusable on touch, and it can't show which
 * concepts have no material without the teacher hunting for greyed-out rows.
 */
export function SkillMultiPicker({
  skills, values, onChange, capacity, countNoun, label = "Concepts", hint, idPrefix, disabled,
}: {
  skills: SkillsResult | null;
  values: string[];
  onChange: (nodeIds: string[]) => void;
  capacity?: Record<string, number>;
  countNoun?: string;
  label?: string;
  hint?: string;
  idPrefix: string;
  disabled?: boolean;
}) {
  const scope = useCurriculumScope(skills);
  const groups = conceptGroups(scope.visible, capacity).filter((g) => g.items.length > 0);
  const chosen = new Set(values);

  if (skills && !skills.signedOff) return <NotSignedOff label={label} idPrefix={idPrefix} />;

  const toggle = (nodeId: string) => {
    // Preserve the order concepts were ticked in: the first is the assessment's
    // primary node, and a teacher's first pick is the one they came for.
    onChange(chosen.has(nodeId) ? values.filter((v) => v !== nodeId) : [...values, nodeId]);
  };

  return (
    <>
      <ScopeFields scope={scope} idPrefix={idPrefix} disabled={disabled} onScopeChange={() => onChange([])} />

      <Field
        label={label}
        hint={values.length > 0 ? `${values.length} selected — grounded in the material behind all of them.` : hint}
      >
        <div
          role="group" aria-label={label}
          style={{
            maxHeight: 220, overflowY: "auto", border: "1px solid var(--pf-border)",
            borderRadius: "var(--pf-radius-sm)", padding: "8px 10px",
          }}
        >
          {groups.length === 0 && <p className="muted" style={{ margin: 0 }}>No concepts in this subject yet.</p>}
          {groups.map((g) => (
            <fieldset key={g.label} style={{ border: "none", margin: 0, padding: "0 0 8px" }}>
              <legend className="person__meta" style={{ padding: 0 }}>{g.label}</legend>
              {g.items.map((t) => (
                <label
                  key={t.node.id}
                  style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13, padding: "2px 0", opacity: g.disabled ? 0.55 : 1 }}
                >
                  <input
                    type="checkbox" checked={chosen.has(t.node.id)}
                    disabled={disabled || g.disabled}
                    onChange={() => toggle(t.node.id)}
                  />
                  <span>{optionLabel(t, capacity, countNoun)}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </Field>
    </>
  );
}

/**
 * The subject itself (#19). Filing material is a Year + Subject decision — a
 * teacher uploading a textbook knows it's Year 8 Technology, not which of 85
 * concepts each chapter serves. Anything filed here grounds every concept
 * beneath it, so the concept-level refinement stays optional.
 */
export function SubjectPicker({ skills, value, onChange, idPrefix, disabled, hint }: {
  skills: SkillsResult | null;
  /** The chosen subject NODE id (not its label). */
  value: string;
  onChange: (nodeId: string) => void;
  idPrefix: string;
  disabled?: boolean;
  hint?: string;
}) {
  const scope = useCurriculumScope(skills);

  // A school with one signed-off curriculum has its subject select locked, so
  // the teacher never "chooses" it — report it anyway, or Map would stay
  // disabled with the right subject visibly on screen.
  const { activeSubject } = scope;
  useEffect(() => {
    if (activeSubject && activeSubject !== value) onChange(activeSubject);
    if (!activeSubject && value) onChange("");
  }, [activeSubject, value, onChange]);

  if (skills && !skills.signedOff) return <NotSignedOff label="Subject" idPrefix={idPrefix} />;

  return (
    <ScopeFields
      scope={scope} idPrefix={idPrefix} disabled={disabled} subjectHint={hint}
      onScopeChange={() => onChange("")}
    />
  );
}
