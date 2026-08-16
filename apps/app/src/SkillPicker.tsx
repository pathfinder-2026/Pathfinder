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

/** "Mathematics · Year 8" — two graphs can share a subject across year levels. */
function subjectLabel(node: SkillNodeRow): string {
  return node.yearLevel != null ? `${node.label} · Year ${node.yearLevel}` : node.label;
}

/**
 * Subject → Strand → Skill picker over the signed-off graph's real hierarchy.
 *
 * The graph has always been hierarchical (subject/strand/outcome/topic/concept/
 * skill/subskill, linked by parentId), but every screen flattened it into one
 * undifferentiated dropdown — so "Mathematics" itself was selectable as a skill
 * and every strand's skills sat in one list regardless of what was being taught.
 *
 * When `capacity` is supplied, skills the approved pool can't ground are
 * disabled rather than merely offered-then-refused (the empty-generate trap).
 */
export function SkillPicker({
  skills, value, onChange, capacity, countNoun, label = "Skill", hint, idPrefix, disabled,
}: {
  skills: SkillsResult | null;
  value: string;
  onChange: (nodeId: string) => void;
  /** Per-node grounding capacity. Given → ungrounded skills are disabled. */
  capacity?: Record<string, number>;
  /** e.g. "questions" — renders "up to N questions" beside each ready skill. */
  countNoun?: string;
  label?: string;
  hint?: string;
  idPrefix: string;
  disabled?: boolean;
}) {
  const [subjectId, setSubjectId] = useState("");
  const [strandId, setStrandId] = useState("");

  const { subjects, strands, teachable } = useMemo(() => {
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
      strands: nodes.filter((n) => n.type === "strand"),
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

  // A single-subject graph shouldn't make teachers choose "Mathematics" every
  // time — it's pre-scoped and stated instead. (Per subject × year scoping
  // needs more than one signed-off graph to exist; see the multi-graph task.)
  const activeSubject = subjectId || (subjects.length === 1 ? subjects[0]!.id : "");
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
  // With one subject in scope the picker states it rather than asking; with
  // several, the Subject dropdown above is the scope and this stays quiet.
  const scopeNote = subjects.length === 1 && skills?.signedOff
    ? `${subjectLabel(subjects[0]!)} · ${skills.versionName}`
    : null;

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
      {subjects.length > 1 && (
        <Field label="Subject" htmlFor={`${idPrefix}-subject`}>
          <select
            id={`${idPrefix}-subject`} className="select" value={activeSubject} disabled={disabled}
            onChange={(e) => { setSubjectId(e.target.value); setStrandId(""); onChange(""); }}
          >
            <option value="">All subjects</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{subjectLabel(s)}</option>)}
          </select>
        </Field>
      )}

      {strands.length > 0 && (
        <Field label="Strand" htmlFor={`${idPrefix}-strand`} hint={scopeNote ?? undefined}>
          <select
            id={`${idPrefix}-strand`} className="select" value={strandId} disabled={disabled}
            onChange={(e) => {
              setStrandId(e.target.value);
              // Keep the form honest: a selection outside the new strand is cleared.
              if (selected && e.target.value && selected.strandId !== e.target.value) onChange("");
            }}
          >
            <option value="">All strands</option>
            {strands
              .filter((s) => !activeSubject || s.parentId === activeSubject)
              .map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
      )}

      <Field label={label} htmlFor={`${idPrefix}-skill`} hint={selected ? selected.path.join(" → ") : hint}>
        <select
          id={`${idPrefix}-skill`} className="select" value={value} disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose a skill…</option>
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
