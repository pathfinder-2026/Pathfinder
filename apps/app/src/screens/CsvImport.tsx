import { useState } from "react";
import { api, type Session } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell } from "../components";

/** FR-ADM-003 — bulk import users from CSV with per-row results. */
export function CsvImport({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [csv, setCsv] = useState("firstName,lastName,email,role,class\n");
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.importUsers>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      setResult(await api.importUsers(session, csv));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <PageShell displayName={displayName} title="Import users (CSV)" onBack={onBack} onSignOut={onSignOut}
      lede="Paste a CSV with columns firstName, lastName, email, role, class. Each row is handled independently — valid rows import even if others fail.">
      <Card>
        {error && <Banner kind="error">{error}</Banner>}
        <Field label="CSV content" hint="Header row required. Roles: student, teacher, parent, principal. Class must match an existing class name.">
          <textarea className="input" style={{ minHeight: 160, fontFamily: "monospace", fontSize: 13 }} value={csv} onChange={(e) => setCsv(e.target.value)} />
        </Field>
        <Button variant="primary" onClick={run} disabled={busy}>{busy ? "Importing…" : "Import"}</Button>
      </Card>

      {result && (
        <Card>
          <div className="card__head"><h2 className="section">Results — {result.totalRows} rows</h2></div>
          <div className="tiles">
            <div className="tile"><div className="tile__num">{result.imported.length}</div><div className="tile__label">Imported</div></div>
            <div className="tile"><div className="tile__num">{result.rejected.length}</div><div className="tile__label">Rejected</div></div>
            <div className="tile"><div className="tile__num">{result.duplicates.length}</div><div className="tile__label">Duplicates skipped</div></div>
            <div className="tile"><div className="tile__num">{result.flaggedForReview}</div><div className="tile__label">Flagged for review</div></div>
          </div>
          {result.rejected.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Rejected rows <Chip state="draft">Fix &amp; re-import</Chip></h3>
              <ul className="people">
                {result.rejected.map((r) => (
                  <li className="person" key={r.line}><span className="person__meta">Row {r.line}</span><span>{r.errors.join("; ")}</span></li>
                ))}
              </ul>
            </>
          )}
          {result.duplicates.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Duplicates skipped</h3>
              <ul className="people">
                {result.duplicates.map((d) => (
                  <li className="person" key={d.line}><span className="person__meta">Row {d.line}</span><span>{d.email}</span><span className="spacer" /><Chip state="pending">Skipped</Chip></li>
                ))}
              </ul>
            </>
          )}
          {result.flaggedForReview > 0 && (
            <Banner kind="warn">{result.flaggedForReview} row(s) contained spreadsheet-formula content — the values were neutralised (stored as inert text) and imported for your review.</Banner>
          )}
        </Card>
      )}
    </PageShell>
  );
}
