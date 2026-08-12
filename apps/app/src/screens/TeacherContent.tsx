import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type ContentRow, type Session, type SkillsResult, type UploadResult } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell, type GovState } from "../components";

const FILE_TYPES = ["pdf", "doc", "docx", "ppt", "pptx", "txt", "md"] as const;

function govChip(status: string): { state: GovState; label: string } {
  if (status === "approved" || status === "published") return { state: "approved", label: "Approved" };
  return { state: "draft", label: "Pending approval" };
}

/**
 * TCH-1 (+minimal TCH-3) — the Teacher Content Studio. Upload material, walk it
 * through the governed pipeline (ingest -> classify -> approve classification ->
 * attest rights -> approve), then map it to signed-off skill-graph nodes. Every
 * governance step is an explicit button — nothing advances by itself.
 */
export function TeacherContent({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [rows, setRows] = useState<ContentRow[] | null>(null);
  const [skills, setSkills] = useState<SkillsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // itemId (or "upload") in flight
  const [open, setOpen] = useState<string | null>(null); // expanded item
  const [mapNode, setMapNode] = useState("");

  // Upload form
  const [title, setTitle] = useState("");
  const [fileType, setFileType] = useState<string>("pdf");
  const [text, setText] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [content, sk] = await Promise.all([api.listContent(session), api.skills(session)]);
      setRows(content); setSkills(sk);
    } catch (e) { setError((e as Error).message); }
  }, [session]);

  useEffect(() => { void refresh(); }, [refresh]);

  const upload = async () => {
    setError(null); setNotice(null); setBusy("upload");
    try {
      const result: UploadResult = await api.uploadContent(session, { title, fileType, text });
      if (result.status === "rejected") {
        setError(`Upload rejected (${result.reason.replace(/_/g, " ")}): ${result.message}`);
      } else {
        setNotice(result.flags.includes("likely_duplicate")
          ? "Uploaded — flagged as a likely duplicate of existing material."
          : "Uploaded. Walk it through the approval steps below.");
        setTitle(""); setText("");
        setOpen(result.contentItemId);
        await refresh();
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const step = async (itemId: string, s: Parameters<typeof api.contentStep>[2]) => {
    setError(null); setBusy(itemId);
    try { await api.contentStep(session, itemId, s); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? `${e.message}` : (e as Error).message); }
    finally { setBusy(null); }
  };

  const map = async (itemId: string) => {
    if (!mapNode) return;
    setError(null); setBusy(itemId);
    try { await api.mapContent(session, itemId, [mapNode]); setMapNode(""); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  /** The next pipeline action for an item, or null when fully approved. */
  const nextAction = (r: ContentRow): { step: Parameters<typeof api.contentStep>[2]; label: string; governance?: boolean } | null => {
    if (r.status === "approved" || r.status === "published") return null;
    if (r.ingestionStatus === "pending" || r.ingestionStatus === "processing") return { step: "ingest", label: "Process (ingest)" };
    if (r.ingestionStatus === "failed") return null; // terminal failure — honest state, re-upload
    if (!r.classification) return { step: "classify", label: "Suggest classification (AI)" };
    if (r.classification.status !== "approved") return { step: "classification/approve", label: "Approve classification", governance: true };
    if (!r.rightsAttested) return { step: "attest", label: "Attest rights", governance: true };
    return { step: "approve", label: "Approve content", governance: true };
  };

  const nodeOptions = skills?.signedOff ? skills.nodes.filter((n) => n.type === "subskill" || n.type === "skill") : [];

  return (
    <PageShell displayName={displayName} title="Content Studio" roleTag="Teacher" backLabel="Back to teacher home"
      onBack={onBack} onSignOut={onSignOut}
      lede="Only material you explicitly approve joins the pool that grounds assessments and suggestions. Each governance step below is yours to take — nothing is approved automatically.">
      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="brand">{notice}</Banner>}
      {skills && !skills.signedOff && (
        <Banner kind="warn">The skill graph isn't signed off yet — approved content can't be mapped until your administrator signs it off.</Banner>
      )}

      <Card>
        <div className="card__head"><h2 className="section">Upload material</h2></div>
        <div className="row">
          <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="File type" hint={`Supported: ${FILE_TYPES.join(", ")}, media & images`}>
            <select className="select" value={fileType} onChange={(e) => setFileType(e.target.value)}>
              {FILE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="exe">exe (unsupported — try it)</option>
            </select>
          </Field>
        </div>
        <Field label="Content" hint="Headings (lines starting with #) become groundable sections — more sections support more assessment questions.">
          <textarea className="input" style={{ minHeight: 120, fontFamily: "monospace", fontSize: 13 }} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Button variant="primary" onClick={upload} disabled={busy === "upload" || !title.trim() || !text.trim()}>
          {busy === "upload" ? "Uploading…" : "Upload"}
        </Button>
      </Card>

      <Card>
        <div className="card__head"><h2 className="section">Library {rows ? `— ${rows.length}` : ""}</h2></div>
        {!rows ? <div className="muted">Loading…</div>
          : rows.length === 0 ? <div className="muted">No material yet — upload something above to get started.</div>
          : (
            <ul className="people">
              {rows.map((r) => {
                const chip = govChip(r.status);
                const action = nextAction(r);
                const expanded = open === r.id;
                return (
                  <li key={r.id} style={{ display: "block", padding: 0, border: "1px solid var(--pf-border)", borderRadius: "var(--pf-radius-sm)" }}>
                    <button className="person" style={{ width: "100%", background: "none", border: "none", font: "inherit", cursor: "pointer", textAlign: "left" }}
                      onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded}>
                      <span className="person__avatar" aria-hidden="true">{(r.fileType ?? "?").slice(0, 3).toUpperCase()}</span>
                      <span><strong>{r.title}</strong></span>
                      <span className="person__meta">{r.mappedNodeIds.length > 0 ? `${r.mappedNodeIds.length} skill${r.mappedNodeIds.length > 1 ? "s" : ""} mapped` : "not mapped"}</span>
                      <span className="spacer" />
                      {r.ingestionStatus === "failed" && <Chip state="pending">Processing failed</Chip>}
                      <Chip state={chip.state}>{chip.label}</Chip>
                    </button>
                    {expanded && (
                      <div style={{ padding: "0 14px 14px" }}>
                        <div className="legend" style={{ marginBottom: 10 }}>
                          <Chip state={r.ingestionStatus === "ingested" ? "approved" : "draft"}>Ingestion: {r.ingestionStatus ?? "—"}</Chip>
                          <Chip state={r.classification?.status === "approved" ? "approved" : "draft"}>
                            Classification: {r.classification ? `${r.classification.subject} · ${r.classification.topic} (${r.classification.status})` : "not yet suggested"}
                          </Chip>
                          <Chip state={r.rightsAttested ? "approved" : "draft"}>Rights: {r.rightsAttested ? "attested" : "not attested"}</Chip>
                        </div>
                        {r.classification?.lowConfidence && (
                          <Banner kind="warn">The AI classification is low-confidence — review it carefully before approving.</Banner>
                        )}
                        {r.approvalBlockReason && (
                          <p className="muted" style={{ margin: "0 0 10px" }}>Approval blocked: {r.approvalBlockReason}.</p>
                        )}
                        <div className="btn-row" style={{ marginTop: 0 }}>
                          {action && (
                            <Button variant={action.governance ? "primary" : "default"} onClick={() => step(r.id, action.step)} disabled={busy === r.id}>
                              {busy === r.id ? "Working…" : action.label}
                            </Button>
                          )}
                          {!action && r.status !== "approved" && r.status !== "published" && r.ingestionStatus === "failed" && (
                            <span className="muted">Processing failed — fix the source material and upload a new version.</span>
                          )}
                          {(r.status === "approved" || r.status === "published") && skills?.signedOff && (
                            <>
                              <select className="select" style={{ maxWidth: 320 }} value={mapNode} onChange={(e) => setMapNode(e.target.value)} aria-label="Skill to map">
                                <option value="">Map to a skill…</option>
                                {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.label}{n.code ? ` (${n.code})` : ""}</option>)}
                              </select>
                              <Button onClick={() => map(r.id)} disabled={busy === r.id || !mapNode}>Map skill</Button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
      </Card>
    </PageShell>
  );
}
