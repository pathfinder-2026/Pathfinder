import { useEffect, useState } from "react";
import { api, type Session } from "../api";
import { Banner, Button, Card, Field, PageShell } from "../components";

/** FR-ADM-003 / FR-INT-001 — configure Google / Microsoft SSO for one domain. */
export function SsoSettings({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [provider, setProvider] = useState("google");
  const [domain, setDomain] = useState("");
  const [saved, setSaved] = useState<{ provider: string; domain: string } | null>(null);
  const [notice, setNotice] = useState<{ kind: "brand" | "error"; text: string } | null>(null);

  useEffect(() => {
    void api.getSso(session).then((c) => { if (c) { setSaved(c); setProvider(c.provider); setDomain(c.domain); } });
  }, [session]);

  const save = async () => {
    setNotice(null);
    try {
      const c = await api.setSso(session, provider, domain);
      setSaved(c);
      setNotice({ kind: "brand", text: `SSO configured for ${c.provider} · ${c.domain}.` });
    } catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
  };

  return (
    <PageShell displayName={displayName} title="Single sign-on" onBack={onBack} onSignOut={onSignOut}
      lede="Let staff and families sign in with your organisation's Google Workspace or Microsoft Entra ID.">
      <Card>
        {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}
        {saved && <p className="muted">Currently: <strong>{saved.provider}</strong> · {saved.domain}</p>}
        <Field label="Identity provider" htmlFor="prov">
          <select id="prov" className="select" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="google">Google Workspace</option>
            <option value="microsoft">Microsoft Entra ID</option>
          </select>
        </Field>
        <Field label="Permitted email domain" hint="Only emails on this domain may sign in. A mismatch is denied with a clear message." htmlFor="dom">
          <input id="dom" className="input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="school.edu" />
        </Field>
        <Button variant="primary" onClick={save} disabled={!domain.trim()}>Save SSO settings</Button>
        <p className="muted" style={{ marginTop: 14 }}>If the provider is temporarily unavailable, sign-in shows a clear "try again" message rather than a login failure. An account suspended by your organisation is denied and its sessions are revoked.</p>
      </Card>
    </PageShell>
  );
}
