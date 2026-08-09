/**
 * Milestone 0 web shell. Screens are deliberately deferred — M0's acceptance
 * criteria are all backend/service logic, and the plan says "nothing needs to
 * be pretty yet". This shell exists so the front-end tooling and the
 * fixed-governance vs. themeable-brand token split have a home from M1 onward.
 */
export function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Pathfinder</h1>
      <p>Milestone 0 — project skeleton. Admin onboarding and the API are backend-driven.</p>
    </main>
  );
}
