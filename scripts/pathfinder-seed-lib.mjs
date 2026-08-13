/**
 * Shared config + tiny HTTP client for the two-school seed scripts
 * (e2e-two-school-seed.mjs, e2e-two-school-add-parents.mjs). Kept in one
 * place so student/parent name generation can never drift between the
 * script that CREATES the roster and a later script that links parents to
 * it by re-deriving the same deterministic emails.
 */

export const BASE = process.env.PF_API ?? "http://localhost:3000";
export const MARKER = "TRANSCRIPT-MARKER-9821";
export const today = new Date().toISOString().slice(0, 10);

// ---- tiny client ----
export async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}
export const GET = (p, o) => call("GET", p, o);
export const POST = (p, o) => call("POST", p, o);
export const PATCH = (p, o) => call("PATCH", p, o);

export async function login(email, password) {
  const r = await POST("/api/v1/auth/login", { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

// ---- reporting ----
export function createReporter() {
  const results = [];
  function check(id, kind, name, ok, detail = "") {
    results.push({ id, kind, name, ok, detail });
    const tag = kind === "skip" ? "SKIP" : ok ? "PASS" : "FAIL";
    console.log(`${tag}  [${id}] (${kind}) ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  }
  const pos = (id, name, ok, detail) => check(id, "positive", name, ok, detail);
  const neg = (id, name, ok, detail) => check(id, "negative", name, ok, detail);
  const skip = (id, name, detail) => check(id, "skip", name, true, detail);
  async function section(id, name, fn) {
    try {
      await fn();
    } catch (e) {
      check(id, "positive", name, false, `threw: ${e.message}`);
    }
  }
  function summarize() {
    const failed = results.filter((r) => r.kind !== "skip" && !r.ok);
    const posCount = results.filter((r) => r.kind === "positive").length;
    const negCount = results.filter((r) => r.kind === "negative").length;
    const skipCount = results.filter((r) => r.kind === "skip").length;
    console.log(`\n================= SUMMARY =================`);
    console.log(`${results.length} checks: ${results.length - failed.length - skipCount} passed, ${failed.length} failed, ${skipCount} skipped`);
    console.log(`(${posCount} positive, ${negCount} negative, ${skipCount} skipped)`);
    if (failed.length) {
      console.log(`\nFAILED:`);
      for (const f of failed) console.log(`  [${f.id}] ${f.name} ${f.detail}`);
    }
    return failed.length;
  }
  return { results, pos, neg, skip, section, summarize };
}

// ---- fictitious name pools (deterministic, not random — reproducible) ----
export const FIRST = ["Aaliyah","Liam","Chloe","Noah","Priya","Ethan","Mia","Lucas","Zara","Oliver",
  "Amelia","Kai","Isla","Mason","Ruby","Ali","Grace","Hamish","Layla","Jack",
  "Sophie","Arjun","Ella","Cooper","Aisha","Leo","Freya","Nathan","Ivy","Tyler",
  "Zoe","Jayden","Willow","Marcus","Nadia","Finn","Sienna","Rohan","Poppy","Elijah",
  "Anika","Harrison","Maya","Xavier","Charlotte","Dylan","Sara","Beau","Amara","Toby"];
export const LAST = ["Nguyen","Smith","Kumar","Wilson","Chen","Taylor","Patel","Brown","Singh","Anderson",
  "Lee","Thompson","Ahmed","White","Tran","Martin","Khan","Clark","Hassan","Walker",
  "Young","Farrell","King","Choudhury","Scott","Ibrahim","Baker","Osei","Reid","Campbell"];
export function nameFor(globalIndex) {
  return [FIRST[globalIndex % FIRST.length], LAST[(globalIndex * 7 + 3) % LAST.length]];
}

/** Adult first-name pool for parents — kept distinct from student first names. */
export const ADULT_FIRST = ["Sarah","David","Michelle","James","Linda","Robert","Karen","Michael","Jennifer","Daniel",
  "Susan","Peter","Rachel","Andrew","Fiona","Simon","Diane","Paul","Helen","Mark",
  "Julie","Steven","Carol","Brian","Nicole","Anthony","Rebecca","Gary","Tracy","Adam",
  "Kate","Chris","Emma","Greg","Lisa","Samir","Vicky","Richard","Jodie","Owen",
  "Bianca","Trent","Wendy","Colin","Yasmin"];
export function adultFirstFor(globalIndex) {
  return ADULT_FIRST[globalIndex % ADULT_FIRST.length];
}
export const RELATIONSHIPS = ["mother", "father", "guardian"];

/** Deterministic, documented password formula — reproducible from this file alone. */
export function studentPassword(schoolKey, classIndex, studentIndexInClass) {
  return `student-${schoolKey}-${classIndex + 1}-${String(studentIndexInClass + 1).padStart(2, "0")}`;
}
export function parentPassword(schoolKey, classIndex, studentIndexInClass) {
  return `parent-${schoolKey}-${classIndex + 1}-${String(studentIndexInClass + 1).padStart(2, "0")}`;
}

export function buildStudents(def, globalIndexStart) {
  const roster = [];
  let gi = globalIndexStart;
  def.classes.forEach((klass, classIndex) => {
    for (let s = 0; s < def.studentsPerClass; s++) {
      const [firstName, lastName] = nameFor(gi);
      roster.push({
        firstName, lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${gi}@${def.domain}`,
        password: studentPassword(def.key, classIndex, s),
        className: klass.name,
        classIndex,
        studentIndexInClass: s,
        globalIndex: gi,
      });
      gi++;
    }
  });
  return roster;
}

/** One parent per student, sharing the child's surname; deterministic + reproducible. */
export function buildParents(def, students) {
  return students.map((st) => {
    const parentFirst = adultFirstFor(st.globalIndex + 137); // offset so parent/child first-name indices never coincide
    return {
      firstName: parentFirst,
      lastName: st.lastName,
      email: `${parentFirst.toLowerCase()}.${st.lastName.toLowerCase()}${st.globalIndex}@${def.domain}`,
      password: parentPassword(def.key, st.classIndex, st.studentIndexInClass),
      relationship: RELATIONSHIPS[st.globalIndex % RELATIONSHIPS.length],
      forStudent: st,
    };
  });
}

// ---- school definitions ----
export const SCHOOLS = [
  {
    key: "hva",
    schoolName: "Horizonvale Academy",
    campusName: "Horizonvale Campus",
    domain: "horizonvale.edu.au",
    admin: { firstName: "Ada", lastName: "Admin", email: "ada.admin@horizonvale.edu.au", password: "admin-hva-1" },
    principal: { firstName: "Priya", lastName: "Principal", email: "priya.principal@horizonvale.edu.au", password: "principal-hva-1" },
    teachers: [
      { firstName: "Tara", lastName: "Teach", email: "tara.teach@horizonvale.edu.au", password: "teacher-hva-1" },
      { firstName: "Tom", lastName: "Turner", email: "tom.turner@horizonvale.edu.au", password: "teacher-hva-2" },
      { firstName: "Uma", lastName: "Underwood", email: "uma.underwood@horizonvale.edu.au", password: "teacher-hva-3" },
    ],
    classes: [
      { name: "Year 7 Wattle", yearGroup: "7" },
      { name: "Year 8 Banksia", yearGroup: "8" },
      { name: "Year 9 Grevillea", yearGroup: "9" },
    ],
    studentsPerClass: 15,
    globalIndexStart: 0,
  },
  {
    key: "mhc",
    schoolName: "Meridian Heights College",
    campusName: "Meridian Campus",
    domain: "meridianheights.edu.au",
    admin: { firstName: "Ada", lastName: "Admin", email: "ada.admin@meridianheights.edu.au", password: "admin-mhc-1" },
    principal: { firstName: "Marcus", lastName: "Meridian", email: "marcus.meridian@meridianheights.edu.au", password: "principal-mhc-1" },
    teachers: [
      { firstName: "Wei", lastName: "Chen", email: "wei.chen@meridianheights.edu.au", password: "teacher-mhc-1" },
      { firstName: "Fatima", lastName: "Hassan", email: "fatima.hassan@meridianheights.edu.au", password: "teacher-mhc-2" },
      { firstName: "Liam", lastName: "OBrien", email: "liam.obrien@meridianheights.edu.au", password: "teacher-mhc-3" },
    ],
    classes: [
      { name: "Year 7 Coral", yearGroup: "7" },
      { name: "Year 8 Reef", yearGroup: "8" },
      { name: "Year 9 Tide", yearGroup: "9" },
    ],
    studentsPerClass: 15,
    globalIndexStart: 45,
  },
];

/** Invite a batch of people under one role, accept, resolve sessions. Recovers via login if already invited (idempotent re-run). */
export async function inviteMany(S, adminTok, role, people) {
  const invited = [];
  for (const p of people) {
    const inv = await POST(`${S}/invites`, { token: adminTok, body: { role, email: p.email, firstName: p.firstName, lastName: p.lastName } });
    invited.push({ p, status: inv.status, inviteId: inv.body?.inviteId });
  }
  const list = await GET(`${S}/invites`, { token: adminTok });
  const byId = new Map((list.body ?? []).map((r) => [r.id, r.inviteToken]));
  const out = {};
  for (const { p, status, inviteId } of invited) {
    if (status !== 201) {
      const s = await login(p.email, p.password); // recovered from a prior run
      const me = await GET("/api/v1/me", { token: s.token });
      out[p.email] = { token: s.token, userId: me.body.userId, ...p };
      continue;
    }
    const tok = byId.get(inviteId);
    const accepted = await POST("/api/v1/invites/accept", { body: { token: tok, password: p.password } });
    const me = await GET("/api/v1/me", { token: accepted.body.token });
    out[p.email] = { token: accepted.body.token, userId: me.body.userId, ...p };
  }
  return out;
}
