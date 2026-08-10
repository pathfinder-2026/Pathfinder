import { useEffect, useState } from "react";
import { useApi } from "./api";
import { Overview } from "./screens/Overview";
import { Dashboard } from "./screens/Dashboard";
import { Content } from "./screens/Content";
import { SkillGraph } from "./screens/SkillGraph";
import { Assessments } from "./screens/Assessments";
import { Synthetic } from "./screens/Synthetic";
import { Admin } from "./screens/Admin";

interface NavDef { route: string; label: string; ico: string; tag: string; title: string; sub: string; }

const NAV: NavDef[] = [
  { route: "overview", label: "Overview", ico: "◎", tag: "", title: "Overview", sub: "Everything built so far, at a glance" },
  { route: "dashboard", label: "Teacher Dashboard", ico: "▦", tag: "5a", title: "Teacher Dashboard", sub: "Mastery, focus areas, cohorts & adaptive engine" },
  { route: "content", label: "Content Studio", ico: "❒", tag: "M1", title: "Content Studio", sub: "Approved-content pool and the governance gate" },
  { route: "skillgraph", label: "Skill Graph", ico: "⧉", tag: "M2", title: "Skill Graph", sub: "Versioned, signed-off curriculum graph" },
  { route: "assessments", label: "Assessments", ico: "✎", tag: "M3", title: "Assessment Builder", sub: "Grounded generation, draft until published" },
  { route: "synthetic", label: "Synthetic Data", ico: "⚗", tag: "M4", title: "Synthetic Activity", sub: "Quarantined test students feeding the dashboard" },
  { route: "admin", label: "Admin", ico: "⚙", tag: "M0", title: "School Administration", sub: "School, campuses, accounts & roles" },
];

function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.slice(2) || "overview");
  useEffect(() => {
    const on = () => setRoute(window.location.hash.slice(2) || "overview");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

function go(route: string) { window.location.hash = `#/${route}`; }

interface BrandResp { brand: { productName: string }; }
interface OverviewResp { school: { name: string }; }

export function App() {
  const route = useHashRoute();
  const brand = useApi<BrandResp>("/brand");
  const overview = useApi<OverviewResp>("/overview");
  const nav = NAV.find((n) => n.route === route) ?? NAV[0];
  const productName = brand.data?.brand.productName ?? "Pathfinder";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <div className="brand-name">{productName}</div>
            <div className="brand-sub">Preview console</div>
          </div>
        </div>
        <div className="nav-group-label">Milestones 0–5a</div>
        {NAV.map((n) => (
          <button key={n.route} className={`nav-item ${n.route === route ? "active" : ""}`} onClick={() => go(n.route)}>
            <span className="ico">{n.ico}</span>
            <span>{n.label}</span>
            {n.tag && <span className="tag">{n.tag}</span>}
          </button>
        ))}
        <div className="sidebar-foot">
          Preview / validation build — not the production design system. Renders the
          already-tested M0–M5a services against a seeded demo school.
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{nav.title}</h1>
            <div className="sub">{nav.sub}</div>
          </div>
          <div className="school-badge">
            <span>◍</span>{overview.data?.school.name ?? "Demo school"}
          </div>
        </header>
        <div className="page">
          {route === "overview" && <Overview onGo={go} />}
          {route === "dashboard" && <Dashboard />}
          {route === "content" && <Content />}
          {route === "skillgraph" && <SkillGraph />}
          {route === "assessments" && <Assessments />}
          {route === "synthetic" && <Synthetic />}
          {route === "admin" && <Admin />}
        </div>
      </main>
    </div>
  );
}
