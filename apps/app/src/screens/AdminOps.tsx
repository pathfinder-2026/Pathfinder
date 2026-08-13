import { useCallback, useEffect, useState } from "react";
import { api, type Session } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell } from "../components";

/** ADM-8 — standalone safeguarding settings (Ask for Help is gated on this). */
export function SafeguardingSettings({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [current, setCurrent] = useState<Awaited<ReturnType<typeof api.getSafeguarding>> | null>(null);
  const [form, setForm] = useState({ contactName: "", contactRole: "Designated Safeguarding Lead", slaHours: 24, afterHoursPolicy: "On-call DSL phone" });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.getSafeguarding(session).then(setCurrent).catch((e) => setError((e as Error).message)), [session]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setError(null); setNotice(null);
    try {
      await api.setSafeguarding(session, form);
      setNotice("Safeguarding contact saved — Ask for Help is now available to students.");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <PageShell displayName={displayName} title="Safeguarding" onBack={onBack} onSignOut={onSignOut}
      lede="The nominated contact every safeguarding disclosure escalates to. Students cannot use Ask for Help until this is configured.">
      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="brand">{notice}</Banner>}
      <Card>
        {current && !current.configured && (
          <Banner kind="warn">Not configured — Ask for Help is disabled for every student until a contact is nominated.</Banner>
        )}
        {current?.configured && (
          <Banner kind="brand">Configured: {current.contactName} ({current.contactRole}) · SLA {current.slaHours}h · after hours: {current.afterHoursPolicy}</Banner>
        )}
        <div className="row">
          <Field label="Contact name" htmlFor="sg-name"><input id="sg-name" className="input" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
          <Field label="Role" htmlFor="sg-role"><input id="sg-role" className="input" value={form.contactRole} onChange={(e) => setForm({ ...form, contactRole: e.target.value })} /></Field>
        </div>
        <div className="row">
          <Field label="Response SLA (hours)" htmlFor="sg-sla"><input id="sg-sla" className="input" type="number" min={1} value={form.slaHours} onChange={(e) => setForm({ ...form, slaHours: Number(e.target.value) })} /></Field>
          <Field label="After-hours policy" htmlFor="sg-ah"><input id="sg-ah" className="input" value={form.afterHoursPolicy} onChange={(e) => setForm({ ...form, afterHoursPolicy: e.target.value })} /></Field>
        </div>
        <Button variant="primary" onClick={save} disabled={!form.contactName.trim()}>Save contact</Button>
      </Card>
    </PageShell>
  );
}

/** ADM-9 — school report + prorated billing (school-level only, no per-teacher view). */
export function SchoolReports({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [report, setReport] = useState<Awaited<ReturnType<typeof api.schoolReport>> | null>(null);
  const [licence, setLicence] = useState({ seats: "100", monthlyRate: "500", startDate: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.schoolReport(session).then(setReport).catch((e) => setError((e as Error).message)), [session]);
  useEffect(() => { void load(); }, [load]);

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <PageShell displayName={displayName} title="School report & billing" onBack={onBack} onSignOut={onSignOut}
      lede="Performance, coverage and usage at school level — no per-teacher comparison here — plus the licence cost report with prorated lines flagged.">
      {error && <Banner kind="error">{error}</Banner>}
      {report && (
        <>
          <Card>
            <div className="card__head"><h2 className="section">This school</h2></div>
            <div className="tiles">
              <div className="tile"><div className="tile__num">{pct(report.performance.avgScore)}</div><div className="tile__label">Avg mastery</div></div>
              <div className="tile"><div className="tile__num">{report.performance.atRiskCount}</div><div className="tile__label">Students at risk</div></div>
              <div className="tile"><div className="tile__num">{report.coverage}</div><div className="tile__label">Skills covered</div></div>
              <div className="tile"><div className="tile__num">{report.usage.assessmentsGenerated}</div><div className="tile__label">Assessments generated</div></div>
              <div className="tile"><div className="tile__num">{report.usage.agentDrafts}</div><div className="tile__label">Agent drafts</div></div>
            </div>
          </Card>
          <Card>
            <div className="card__head"><h2 className="section">Cost — {report.cost.month}</h2></div>
            {report.cost.lines.length === 0 ? <Banner kind="brand">No licences recorded yet — add one below.</Banner> : (
              <div style={{ overflowX: "auto" }}>
                <table className="heatmap" aria-label="Licence cost lines">
                  <thead><tr><th scope="col">Seats</th><th scope="col">Monthly rate</th><th scope="col">This month</th><th scope="col"></th></tr></thead>
                  <tbody>
                    {report.cost.lines.map((l) => (
                      <tr key={l.licenceId}>
                        <td>{l.seats}</td>
                        <td>${l.monthlyRate.toFixed(2)}</td>
                        <td>${l.proratedCost.toFixed(2)}</td>
                        <td>{l.prorated && <Chip state="pending">Prorated — partial month</Chip>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ marginTop: 10 }}><strong>Total: ${report.cost.total.toFixed(2)}</strong></p>
            <div className="row" style={{ marginTop: 14 }}>
              <Field label="Seats" htmlFor="lic-seats"><input id="lic-seats" className="input" type="number" value={licence.seats} onChange={(e) => setLicence({ ...licence, seats: e.target.value })} /></Field>
              <Field label="Monthly rate ($)" htmlFor="lic-rate"><input id="lic-rate" className="input" type="number" value={licence.monthlyRate} onChange={(e) => setLicence({ ...licence, monthlyRate: e.target.value })} /></Field>
            </div>
            <Field label="Start date" htmlFor="lic-start"><input id="lic-start" className="input" type="date" value={licence.startDate} onChange={(e) => setLicence({ ...licence, startDate: e.target.value })} /></Field>
            <Button onClick={async () => {
              setError(null);
              try { await api.addLicence(session, { seats: Number(licence.seats), monthlyRate: Number(licence.monthlyRate), startDate: licence.startDate }); await load(); }
              catch (e) { setError((e as Error).message); }
            }} disabled={!licence.startDate}>Add licence</Button>
          </Card>
        </>
      )}
    </PageShell>
  );
}

/** ADM-10 — read-only audit viewer: ids only, chain-verified badge. */
export function AuditViewer({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.auditLog>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const PAGE = 25;

  useEffect(() => { api.auditLog(session, page * PAGE, PAGE).then(setData).catch((e) => setError((e as Error).message)); }, [session, page]);

  return (
    <PageShell displayName={displayName} title="Audit log" onBack={onBack} onSignOut={onSignOut}
      lede="The append-only, hash-chained governance record. Rows reference ids only — no personal data or message content is ever shown here.">
      {error && <Banner kind="error">{error}</Banner>}
      {data && (
        <Card>
          <div className="card__head" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <h2 className="section">{data.total} entries</h2>
            {data.chainVerified
              ? <Chip state="approved">Chain verified</Chip>
              : <Chip state="draft">Chain verification FAILED</Chip>}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="heatmap" aria-label="Audit entries">
              <thead><tr><th scope="col">#</th><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Actor</th><th scope="col">Subject</th></tr></thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.seq}>
                    <td>{e.seq}</td>
                    <td>{new Date(e.at).toLocaleString()}</td>
                    <td>{e.action}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{e.actorId ? `${e.actorId.slice(0, 8)}…` : "system"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{e.subjectType}:{e.subjectId.slice(0, 8)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="btn-row">
            <Button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Newer</Button>
            <Button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * PAGE >= data.total}>Older</Button>
            <span className="muted">Page {page + 1}</span>
          </div>
        </Card>
      )}
    </PageShell>
  );
}

/** ADM-11 — data-subject export + erase (FR-GOV-006). */
export function DataSubject({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [students, setStudents] = useState<{ userId: string; label: string }[]>([]);
  const [studentId, setStudentId] = useState("");
  const [exported, setExported] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ tasks: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.accounts(session).then((rows) => setStudents(
      rows.filter((r) => r.role === "student" && r.status !== "erased").map((r) => ({ userId: r.userId, label: `${r.firstName ?? "?"} ${r.lastName ?? ""}`.trim() })),
    )).catch((e) => setError((e as Error).message));
  }, [session]);

  const doExport = async () => {
    setError(null); setNotice(null);
    try { setExported(JSON.stringify(await api.exportStudent(session, studentId), null, 2)); }
    catch (e) { setError((e as Error).message); }
  };

  const doErase = async (confirm: boolean) => {
    setError(null); setNotice(null);
    try {
      const result = await api.eraseStudent(session, studentId, confirm);
      if (!result.erased && result.requiresConfirmation) { setConfirming({ tasks: result.affected?.tasks ?? 0 }); return; }
      setConfirming(null); setExported(null);
      setNotice("Erased. Personal data is removed; audited facts and the id-only hash chain are retained and still verify.");
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <PageShell displayName={displayName} title="Data-subject requests" onBack={onBack} onSignOut={onSignOut}
      lede="Export a student's data in readable form, or erase their personal data. Erasure removes PII; audited facts and the hash chain are retained by design (FR-GOV-006).">
      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="brand">{notice}</Banner>}
      <Card>
        <Field label="Student" htmlFor="ds-student">
          <select id="ds-student" className="select" style={{ maxWidth: 340 }} value={studentId} onChange={(e) => { setStudentId(e.target.value); setExported(null); setConfirming(null); }}>
            <option value="">Choose…</option>
            {students.map((s) => <option key={s.userId} value={s.userId}>{s.label}</option>)}
          </select>
        </Field>
        <div className="btn-row" style={{ marginTop: 0 }}>
          <Button onClick={doExport} disabled={!studentId}>Export</Button>
          <Button variant="ghost" onClick={() => doErase(false)} disabled={!studentId}>Erase…</Button>
        </div>
        {confirming && (
          <Banner kind="warn">
            This student has active records ({confirming.tasks} task{confirming.tasks === 1 ? "" : "s"}). Erasing removes their personal data everywhere;
            audited facts and the id-only hash chain are <strong>retained</strong> and remain verifiable. This cannot be undone.
            <span className="btn-row" style={{ marginTop: 8 }}>
              <Button variant="primary" onClick={() => doErase(true)}>Yes, erase personal data</Button>
              <Button variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
            </span>
          </Banner>
        )}
        {exported && (
          <>
            <h3 style={{ fontSize: 14, margin: "16px 0 8px" }}>Export</h3>
            <pre style={{ fontSize: 12, background: "var(--pf-paper)", padding: 12, borderRadius: 8, overflowX: "auto", maxHeight: 320 }}>{exported}</pre>
          </>
        )}
      </Card>
    </PageShell>
  );
}
