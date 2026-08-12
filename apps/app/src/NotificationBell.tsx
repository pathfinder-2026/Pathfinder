import { useEffect, useState } from "react";
import { api, type Session } from "./api";

const READ_KEY = "pf.notifications.read";

function readIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? "[]") as string[]); }
  catch { return new Set(); }
}

/**
 * S-NOTIF — the in-app notification bell + panel. The server filters to the
 * signed-in user's own messages and never serves safeguarding alerts on this
 * surface (they follow the FR-SAF-002 workflow). Read-state is a client-side
 * convenience (localStorage) — the server record stays untouched.
 */
export function NotificationBell({ session }: { session: Session }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.notifications>>>([]);
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Set<string>>(readIds);

  useEffect(() => { api.notifications(session).then(setItems).catch(() => setItems([])); }, [session]);

  const unread = items.filter((i) => !read.has(i.id)).length;
  const markAllRead = () => {
    const next = new Set([...read, ...items.map((i) => i.id)]);
    setRead(next);
    localStorage.setItem(READ_KEY, JSON.stringify([...next]));
  };

  const ICONS: Record<string, string> = {
    "invite.teacher": "✉", "invite.student": "✉", "invite.parent": "✉",
    "alert.teacher": "⚠", "alert.overdue": "⏰", "parent.digest": "📋",
  };

  return (
    <span style={{ position: "relative" }}>
      <button className="linkish" aria-label={`Notifications${unread ? ` — ${unread} unread` : ""}`}
        aria-expanded={open} onClick={() => { setOpen(!open); if (!open) markAllRead(); }}
        style={{ fontSize: 17, position: "relative" }}>
        🔔
        {unread > 0 && (
          <span aria-hidden="true" style={{
            position: "absolute", top: -4, right: -8, background: "var(--gov-error)", color: "#fff",
            borderRadius: 999, fontSize: 10, fontWeight: 700, padding: "1px 5px",
          }}>{unread}</span>
        )}
      </button>
      {open && (
        <div role="region" aria-live="polite" aria-label="Notifications" style={{
          position: "absolute", right: 0, top: "calc(100% + 10px)", width: 340, maxHeight: 420, overflowY: "auto",
          background: "var(--pf-card)", border: "1px solid var(--pf-border)", borderRadius: 10,
          boxShadow: "var(--pf-shadow-card)", padding: 12, zIndex: 20,
        }}>
          {items.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nothing yet.</p>
          ) : (
            <ul className="people" style={{ margin: 0 }}>
              {items.map((n) => (
                <li className="person" key={n.id} style={{ alignItems: "flex-start" }}>
                  <span aria-hidden="true">{ICONS[n.type] ?? "•"}</span>
                  <span style={{ flex: 1 }}>
                    <strong style={{ display: "block", fontSize: 13 }}>{n.subject}</strong>
                    <span className="person__meta">{n.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
