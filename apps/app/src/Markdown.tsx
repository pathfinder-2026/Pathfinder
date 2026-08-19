import { type ReactNode } from "react";

/**
 * Minimal Markdown renderer for agent drafts — headings, lists, bold/italic,
 * paragraphs. Teachers should read a lesson plan as a document, not raw `##`
 * markup (which is what the drafts card showed before).
 *
 * Built as React elements, never innerHTML: draft content is AI output and a
 * teacher's own edits — data, not trusted markup. Anything the tiny grammar
 * doesn't recognise renders as plain text, unchanged.
 */

/** Inline **bold** and *italic* spans. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/;
  while (rest.length > 0) {
    const m = rest.match(re);
    if (!m || m.index === undefined) { out.push(rest); break; }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    if (m[1] !== undefined) out.push(<strong key={k++}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<em key={k++}>{m[2]}</em>);
    else out.push(<code key={k++}>{m[3]}</code>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push(<p key={key++} style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.55 }}>{inline(para.join(" "))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i} style={{ marginBottom: 3 }}>{inline(it)}</li>);
    blocks.push(list.ordered
      ? <ol key={key++} style={{ margin: "0 0 10px", paddingLeft: 22, fontSize: 13.5, lineHeight: 1.55 }}>{items}</ol>
      : <ul key={key++} style={{ margin: "0 0 10px", paddingLeft: 22, fontSize: 13.5, lineHeight: 1.55 }}>{items}</ul>);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);

    if (line.trim() === "") { flushPara(); flushList(); continue; }
    if (heading) {
      flushPara(); flushList();
      const level = heading[1]!.length;
      const sizes: Record<number, number> = { 1: 17, 2: 15, 3: 14, 4: 13.5 };
      blocks.push(
        <div key={key++} style={{ fontSize: sizes[level], fontWeight: 700, margin: level === 1 ? "0 0 8px" : "14px 0 6px", color: "var(--pf-ink)" }}>
          {inline(heading[2]!)}
        </div>,
      );
      continue;
    }
    if (bullet) {
      flushPara();
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]!);
      continue;
    }
    if (numbered) {
      flushPara();
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(numbered[1]!);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();

  return <div>{blocks}</div>;
}
