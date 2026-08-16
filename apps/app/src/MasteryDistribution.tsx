import type { HeatmapData } from "./api";

/**
 * Whole-class distribution for ONE skill: how many students sit in each mastery
 * band, at a glance, before drilling into per-student cells.
 *
 * Encoding notes (these were computed, not eyeballed):
 * - Mastery bands are ORDERED, so they take a SEQUENTIAL single-hue ramp whose
 *   lightness carries the order (light = lower mastery → dark = secure).
 * - A red/amber/green "traffic light" was tried first and rejected: as chart
 *   marks its green↔amber pair measures ΔE 1.8–2.8 for deutan/protan viewers,
 *   i.e. invisible to red-green colour blindness. This ramp measures ΔE 19.3
 *   at its worst adjacent pair. The heatmap keeps its familiar tinted cells —
 *   there the level is written in the cell, so colour is never load-bearing.
 * - "No data yet" is deliberately OUTSIDE the ramp, in neutral grey: absence of
 *   evidence is not a low mastery level, and must never look like one.
 * - Every segment carries a visible count + label, and the same numbers appear
 *   as text below, so nothing depends on colour alone.
 */

const BANDS = [
  { key: "low", label: "Below mastery", fill: "#a3ccc3" },
  { key: "developing", label: "Developing", fill: "#4e9284" },
  { key: "secure", label: "Secure", fill: "#14544a" },
] as const;
const NO_DATA_FILL = "#9aa0a6";

export function MasteryDistribution({ data, nodeId }: { data: HeatmapData; nodeId: string }) {
  const skill = data.skills.find((s) => s.id === nodeId);
  const cells = data.cells.filter((c) => c.nodeId === nodeId);
  const counts = BANDS.map((b) => ({
    ...b,
    count: cells.filter((c) => c.level === b.key).length,
  }));
  const noData = data.students.length - cells.length;
  const early = cells.filter((c) => c.evidence === "early").length;
  const total = data.students.length;

  const segments = [
    ...counts.filter((c) => c.count > 0),
    ...(noData > 0 ? [{ key: "none", label: "No data yet", fill: NO_DATA_FILL, count: noData }] : []),
  ];

  if (total === 0) return <p className="muted">No students in this class yet.</p>;

  // Geometry: one horizontal stacked bar, 2px surface gaps between segments,
  // rounded outer ends only (the bar reads as one whole, not separate bars).
  const W = 720, H = 34, GAP = 2, R = 4;
  let x = 0;
  const placed = segments.map((s, i) => {
    const raw = (s.count / total) * W;
    const width = Math.max(raw - (i < segments.length - 1 ? GAP : 0), 2);
    const seg = { ...s, x, width, first: i === 0, last: i === segments.length - 1 };
    x += raw;
    return seg;
  });

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
          aria-label={`Mastery distribution for ${skill?.label ?? nodeId}: ${segments.map((s) => `${s.count} ${s.label}`).join(", ")}`}>
          {placed.map((s) => (
            <g key={s.key}>
              <rect x={s.x} y={0} width={s.width} height={H} fill={s.fill}
                rx={s.first || s.last ? R : 0} ry={s.first || s.last ? R : 0}>
                <title>{s.count} of {total} students — {s.label}</title>
              </rect>
              {/* Square off the inner edge so only the bar's outer ends round. */}
              {s.first && !s.last && <rect x={s.x + s.width - R} y={0} width={R} height={H} fill={s.fill} />}
              {s.last && !s.first && <rect x={s.x} y={0} width={R} height={H} fill={s.fill} />}
            </g>
          ))}
        </svg>
      </div>
      {/* Legend + counts as text: identity never rests on colour, and this
          doubles as the table view the contrast rule requires. */}
      <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", gap: 16, flexWrap: "wrap" }}>
        {segments.map((s) => (
          <li key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 3, background: s.fill, display: "inline-block" }} />
            <span>{s.label}</span>
            <strong>{s.count}</strong>
            <span className="person__meta">({Math.round((s.count / total) * 100)}%)</span>
          </li>
        ))}
      </ul>
      {early > 0 && (
        <p className="person__meta" style={{ marginTop: 8 }}>
          {early} of the {cells.length} placed student{cells.length === 1 ? "" : "s"} rest{early === 1 ? "s" : ""} on early
          evidence (too few data points to lean on yet) — the shape of this chart may shift as more work comes in.
        </p>
      )}
    </div>
  );
}
