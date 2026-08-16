import { useMemo, useState } from "react";
import type { SkillNodeRow, SkillsResult } from "./api";
import { Field } from "./components";

/** Only leaf teaching targets are selectable — never a subject/strand heading. */
const TEACHABLE = new Set(["skill", "subskill"]);

interface TeachableNode {
  node: SkillNodeRow;
  subjectId: string;
  strandId: string;
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
 * Now: Year, then Subject, then the concepts within it (grouped by their topic
 * area rather than gated behind another dropdown). Each level pre-selects and
 * locks when the school offers only one option, so a single-curriculum school
 * still sees the same hierarchy without extra clicks.
 *
 * When `capacity` is supplied, concepts the approved pool can't ground are
 * disabled rather than merely offered-then-refused (the empty-generate trap).
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
  const [year, setYear] = useState<string>("");
  const [subjectId, setSubjectId] = useState("");
  const [strandId, setStrandId] = useState("");

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
          strandId: chain.find((c) => c.type === "strand")?.id ?? "",
          path: chain.slice(0, -1).map((c) => c.label),
        };
      }),
    };
  }, [skills]);

  // Year → Subject → Concept: how a teacher thinks about their timetable.
  // Each level pre-selects (and locks) when the school offers only one option,
  // so a single-curriculum school still sees the hierarchy without busywork.
  const years = [...new Set(subjects.map((s) => s.yearLevel).filter((y): y is number => y != null))].sort((a, b) => a - b);
  const activeYear = year || (years.length === 1 ? String(years[0]) : "");
  const subjectsForYear = subjects.filter(
    (s) => !activeYear || s.yearLevel == null || String(s.yearLevel) === activeYear,
  );
  const activeSubject = subjectId || (subjectsForYear.length === 1 ? subjectsForYear[0]!.id : "");
  const visible = teachable.filter(
    (t) => (!activeSubject || t.subjectId === activeSubject) && (!strandId || t.strandId === strandId),
  );

  const groundedCount = (t: TeachableNode) => capacity?.[t.node.id] ?? 0;
  const optionLabel = (t: TeachableNode) => {
    const code = t.node.code ? ` (${t.node.code})` : "";
    const count = capacity && countNoun && groundedCount(t) > 0
      ? ` — up to ${groundedCount(t)} ${countNoun}`
      : "";
    return `${t.node.label}${code}${count}`;
  };

  /**
   * Where a skill sits, short enough for a dropdown: its immediate parent, kept
   * under the strand only while every strand is in view (the full chain is up to
   * five levels — unreadable as an option group, so it goes in the hint below).
   */
  const placeOf = (t: TeachableNode) => {
    const withoutSubject = t.path.slice(1);
    const parent = withoutSubject.at(-1) ?? "Skills";
    const strand = withoutSubject[0];
    return !strandId && strand && strand !== parent ? `${strand} → ${parent}` : parent;
  };

  // Grouping always carries the most actionable dimension available: whether a
  // skill can be used at all when we know that, otherwise where it sits.
  const groups: { label: string; items: TeachableNode[]; disabled?: boolean }[] = capacity
    ? [
        { label: "Ready to use", items: visible.filter((t) => groundedCount(t) > 0) },
        { label: "No approved material yet", items: visible.filter((t) => groundedCount(t) === 0), disabled: true },
      ]
    : Object.entries(
        visible.reduce<Record<string, TeachableNode[]>>((acc, t) => {
          (acc[placeOf(t)] ??= []).push(t);
          return acc;
        }, {}),
      ).map(([groupLabel, items]) => ({ label: groupLabel, items }));

  const selected = teachable.find((t) => t.node.id === value);

  if (skills && !skills.signedOff) {
    return (
      <Field label={label} htmlFor={`${idPrefix}-skill`}>
        <select id={`${idPrefix}-skill`} className="select" disabled>
          <option>Skill graph not signed off yet</option>
        </select>
      </Field>
    );
  }

  return (
    <>
      {/* 1 — Year. Shown whenever any curriculum records one; a school with a
          single year sees it locked rather than hidden, so the hierarchy the
          teacher navigates is the same everywhere. */}
      {years.length > 0 && (
        <Field label="Year" htmlFor={`${idPrefix}-year`}>
          <select
            id={`${idPrefix}-year`} className="select" value={activeYear} disabled={disabled || years.length <= 1}
            onChange={(e) => { setYear(e.target.value); setSubjectId(""); setStrandId(""); onChange(""); }}
          >
            {years.length > 1 && <option value="">All years</option>}
            {years.map((y) => <option key={y} value={String(y)}>Year {y}</option>)}
          </select>
        </Field>
      )}

      {/* 2 — Subject. */}
      <Field label="Subject" htmlFor={`${idPrefix}-subject`}>
        <select
          id={`${idPrefix}-subject`} className="select" value={activeSubject}
          disabled={disabled || subjectsForYear.length <= 1}
          onChange={(e) => { setSubjectId(e.target.value); setStrandId(""); onChange(""); }}
        >
          {subjectsForYear.length > 1 && <option value="">All subjects</option>}
          {subjectsForYear.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          {subjectsForYear.length === 0 && <option value="">No curriculum signed off yet</option>}
        </select>
      </Field>

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
                <option key={t.node.id} value={t.node.id} disabled={g.disabled}>{optionLabel(t)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
    </>
  );
}
