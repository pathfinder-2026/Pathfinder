/**
 * Pathfinder — add parent accounts to the two live-seeded schools.
 *
 * Companion to e2e-two-school-seed.mjs (run that FIRST — this script logs
 * into the admin accounts it already created rather than creating schools
 * again, and re-derives the exact same student roster deterministically
 * from pathfinder-seed-lib.mjs so parent-links attach to the real students
 * already in the database).
 *
 * Per school: one VERIFIED parent per student (45), sharing the child's
 * surname, plus one deliberately UNVERIFIED extra parent on the school's
 * first student — the negative "verification-before-data" test case
 * (mirrors the platform's existing single-school demo script).
 *
 * Run:  node scripts/e2e-two-school-add-parents.mjs
 * (API must already be running against the live database.)
 */
import {
  GET, POST, login, createReporter, SCHOOLS, buildStudents, buildParents, inviteMany, today,
} from "./pathfinder-seed-lib.mjs";

const { pos, neg, section, summarize } = createReporter();
const rosters = {}; // key -> { students, parents, parentSessions, extraParent }

async function addParentsForSchool(def) {
  const P = (id) => `${def.key.toUpperCase()}-${id}`;

  const s = await login(def.admin.email, def.admin.password);
  const schoolId = s.schoolId;
  const S = `/api/v1/schools/${schoolId}`;
  const adminTok = s.token;

  const students = buildStudents(def, def.globalIndexStart);
  const parents = buildParents(def, students);

  const accounts = (await GET(`${S}/accounts`, { token: adminTok })).body;
  const rowOf = (email) => accounts.find((a) => a.email === email);
  const missingStudents = students.filter((st) => !rowOf(st.email));
  if (missingStudents.length > 0) {
    throw new Error(`${missingStudents.length} students not found — run e2e-two-school-seed.mjs first (e.g. missing ${missingStudents[0].email})`);
  }

  const parentSessions = await inviteMany(S, adminTok, "parent", parents);
  pos(P("PA1"), `All ${parents.length} parents accept invites and hold sessions`,
    parents.every((p) => !!parentSessions[p.email]));

  let linkedCount = 0;
  const linkIdByParentEmail = {};
  for (const p of parents) {
    const parentUserId = parentSessions[p.email].userId;
    const studentUserId = rowOf(p.forStudent.email).userId;
    const link = await POST(`${S}/parent-links`, { token: adminTok, body: { parentId: parentUserId, studentId: studentUserId, relationship: p.relationship } });
    await POST(`${S}/parent-links/${link.body.id}/verify`, { token: adminTok });
    linkIdByParentEmail[p.email] = link.body.id;
    linkedCount++;
  }
  pos(P("PA2"), `Admin links + verifies all ${linkedCount} parent-child relationships`, linkedCount === parents.length);

  // ---- one deliberately UNVERIFIED extra parent, on the school's first student ----
  const richStudent = students[0];
  const extraParent = {
    firstName: "Uma", lastName: "Unverified",
    email: `uma.unverified.${def.key}@${def.domain}`,
    password: `parent-${def.key}-unverified-1`,
    relationship: "guardian",
    forStudent: richStudent,
  };
  const extraSession = await inviteMany(S, adminTok, "parent", [extraParent]);
  const extra = extraSession[extraParent.email];
  const extraLink = await POST(`${S}/parent-links`, { token: adminTok, body: { parentId: extra.userId, studentId: rowOf(richStudent.email).userId, relationship: extraParent.relationship } });
  const unverifiedDash = await GET(`${S}/parent/children/${rowOf(richStudent.email).userId}/dashboard`, { token: extra.token });
  neg(P("PA3"), "An UNVERIFIED parent link yields no data (hard 401)", unverifiedDash.status === 401);
  void extraLink;

  // ---- verified-parent positive path, using richStudent's REGULAR (verified) parent ----
  const primaryParentEmail = parents[0].email; // paired 1:1 with students[0] = richStudent
  const primary = parentSessions[primaryParentEmail];
  const children = await GET(`${S}/parent/children`, { token: primary.token });
  pos(P("PA4"), "After verification the child appears for the parent", children.body.length === 1);
  const dash = await GET(`${S}/parent/children/${rowOf(richStudent.email).userId}/dashboard`, { token: primary.token });
  pos(P("PA5"), "Parent dashboard is plain-language and non-diagnostic",
    dash.status === 200 && !/diagnos|disorder|deficit|cognitive/i.test(dash.body.summaryText));

  const secondStudentUserId = rowOf(students[1].email).userId;
  const crossChild = await GET(`${S}/parent/children/${secondStudentUserId}/dashboard`, { token: primary.token });
  neg(P("PA6"), "Cross-child access (another family's student) is refused", crossChild.status === 401);

  // ---- weekly digest: give richStudent fresh activity, then run + check ----
  const richSession = await login(richStudent.email, richStudent.password);
  const workspace = await GET(`${S}/student/workspace`, { token: richSession.token });
  const hwTask = [...(workspace.body.today ?? []), ...(workspace.body.thisWeek ?? [])].find((t) => t.title === "Adding fractions practice");
  if (hwTask) await POST(`${S}/student/tasks/${hwTask.id}/complete`, { token: richSession.token });
  const digestRun = await POST(`${S}/parent-digest/run`, { token: adminTok });
  const digests = await GET(`${S}/parent/digests`, { token: primary.token });
  pos(P("PA7"), "Weekly digest: one consolidated update when there is news",
    digestRun.body.sent >= 1 && digests.body.length >= 1);

  rosters[def.key] = { students, parents, extraParent };
}

async function main() {
  console.log(`Adding parent accounts to 2 already-seeded schools\n`);
  for (const def of SCHOOLS) {
    console.log(`\n--- ${def.schoolName} (${def.key}) ---`);
    await section(`${def.key.toUpperCase()}-PARENTS`, `Add parents for ${def.schoolName}`, () => addParentsForSchool(def));
  }

  const failed = summarize();

  console.log(`\n================= PARENT LOGINS (deterministic; password mirrors the child's password with parent- prefix) =================`);
  for (const def of SCHOOLS) {
    const r = rosters[def.key];
    if (!r) continue;
    console.log(`\n${def.schoolName} (first 3 shown; full roster in the CSV block below):`);
    for (const p of r.parents.slice(0, 3)) console.log(`  ${p.email} / ${p.password}  (${p.relationship} of ${p.forStudent.firstName} ${p.forStudent.lastName})`);
    console.log(`  UNVERIFIED test case: ${r.extraParent.email} / ${r.extraParent.password}  (guardian of ${r.students[0].firstName} ${r.students[0].lastName} — deliberately left unverified)`);
  }

  console.log(`\n================= FULL PARENT ROSTER (CSV) =================`);
  console.log("school,relationship,firstName,lastName,email,password,childEmail");
  for (const def of SCHOOLS) {
    const r = rosters[def.key];
    if (!r) continue;
    for (const p of r.parents) {
      console.log(`${def.schoolName},${p.relationship},${p.firstName},${p.lastName},${p.email},${p.password},${p.forStudent.email}`);
    }
    console.log(`${def.schoolName},guardian (UNVERIFIED),${r.extraParent.firstName},${r.extraParent.lastName},${r.extraParent.email},${r.extraParent.password},${r.students[0].email}`);
  }

  void today;
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("Parent-seed crashed:", e); process.exit(1); });
