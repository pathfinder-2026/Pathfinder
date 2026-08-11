import { useEffect, useState } from "react";
import { api, ApiError, type ResolvedBranding, type Session } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell } from "../components";

const SWATCHES = [
  { name: "Pathfinder", color: "#1f6f63" },
  { name: "Ellenbrook", color: "#2c5f9e" },
  { name: "Riverside", color: "#8a3b5e" },
];

/** FR-WL-001..004 — brand colour, logo, white-label; governance signals stay fixed. */
export function BrandingSettings({ session, displayName, onBrandingChanged, onBack, onSignOut }: {
  session: Session; displayName: string; onBrandingChanged: () => void; onBack: () => void; onSignOut: () => void;
}) {
  const [b, setB] = useState<ResolvedBranding | null>(null);
  const [custom, setCustom] = useState("#1f6f63");
  const [whiteLabel, setWhiteLabel] = useState(false);
  const [productName, setProductName] = useState("");
  const [notice, setNotice] = useState<{ kind: "brand" | "warn" | "error"; text: string } | null>(null);

  const refresh = async () => {
    const r = await api.getBranding(session);
    setB(r); setWhiteLabel(r.whiteLabel); onBrandingChanged();
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [session]);

  const applyColor = async (color: string) => {
    setNotice(null);
    try { await api.setBranding(session, { primaryColor: color }); await refresh(); }
    catch (e) {
      const msg = e instanceof ApiError && e.code === "BRAND_CONTRAST_FAILED" ? (e as Error).message : (e as Error).message;
      setNotice({ kind: "warn", text: msg });
    }
  };
  const saveWhiteLabel = async () => {
    setNotice(null);
    try {
      await api.setBranding(session, { whiteLabelEnabled: whiteLabel, productName: productName || undefined });
      await refresh();
      setNotice({ kind: "brand", text: whiteLabel ? "White-label enabled." : "Co-branded with Pathfinder." });
    } catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
  };
  const uploadSvg = async () => {
    setNotice(null);
    const clean = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${custom}"/></svg>`;
    try { await api.uploadLogo(session, { format: "svg", sizeBytes: clean.length, svgSource: clean }); await refresh(); setNotice({ kind: "brand", text: "Logo uploaded." }); }
    catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
  };

  return (
    <PageShell displayName={displayName} title="Branding" onBack={onBack} onSignOut={onSignOut}
      lede="Make Pathfinder your own. Colours are checked for accessible contrast; governance status signals never change.">
      <Card>
        {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}
        <h3 style={{ fontSize: 14, margin: "2px 0 8px" }}>Brand colour</h3>
        <div className="swatches">
          {SWATCHES.map((s) => <button key={s.color} className="swatch" style={{ background: s.color }} title={s.name} aria-label={s.name} onClick={() => applyColor(s.color)} />)}
          <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom colour" style={{ width: 40, height: 34, border: "none", background: "none" }} />
          <Button onClick={() => applyColor(custom)}>Apply custom</Button>
          <Button onClick={uploadSvg}>Upload sample logo</Button>
        </div>
        {b && <p className="muted" style={{ marginTop: 10 }}>Applied colour: <strong>{b.primaryColor}</strong>{b.logo.available ? " · logo set" : " · no logo (text fallback)"}</p>}

        <h3 style={{ fontSize: 14, margin: "22px 0 8px" }}>White-label</h3>
        <label className="field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={whiteLabel} onChange={(e) => setWhiteLabel(e.target.checked)} />
          <span className="field__label" style={{ margin: 0 }}>Show our own name instead of “Pathfinder”</span>
        </label>
        {whiteLabel && <Field label="Product name" htmlFor="pn"><input id="pn" className="input" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Riverbank Learning" /></Field>}
        <Button onClick={saveWhiteLabel}>Save white-label</Button>

        <div style={{ marginTop: 22, padding: 14, background: "var(--pf-paper)", borderRadius: "var(--pf-radius-md)" }}>
          <p className="muted" style={{ margin: "0 0 8px" }}>Fixed trust signals (never your brand colour):</p>
          <div className="legend"><Chip state="draft">Draft</Chip><Chip state="approved">Approved</Chip><Chip state="locked">Computed · locked</Chip></div>
        </div>
      </Card>
    </PageShell>
  );
}
