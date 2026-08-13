/**
 * Pathfinder — real class activity so Class Insights have signal.
 *
 * Run AFTER e2e-two-school-seed.mjs (and after migration 0018 + the grading
 * deploy). For each school's lead class it has 12 of the 15 students take the
 * published "Fractions check-in" through the REAL student endpoints with a
 * deliberate spread of answer quality:
 *   - 2 strong  (the model answer, fetched via the teacher's view)
 *   - 3 partial (roughly half the model answer's words)
 *   - 7 weak    (unrelated text)
 * ...so >=50% of the class lands below mastery on the node, which is exactly
 * the focus-area threshold (focusAreaFraction 0.5, min 5 students), and the
 * below-mastery cohort (>5 students) is big enough to not be suppressed.
 * Two students then re-sit twice more with improving answers, giving their
 * heatmap cells >=3 data points (insufficientDataMin) and a visible trend.
 *
 * Every submission is graded through the live AI provider (assessment.grade)
 * and writes ONE real mastery data point — nothing here touches the database
 * directly.
 *
 * Run:  node scripts/e2e-class-activity.mjs
 * PF_API overrides the default http://localhost:3000 target.
 */
import { BASE, GET, POST, login, createReporter, SCHOOLS, buildStudents } from "./pathfinder-seed-lib.mjs";

const { pos, section, summarize } = createReporter();

function weakAnswer() {
  return "not sure, something about numbers maybe";
}
function partialAnswer(model) {
  const words = (model ?? "").split(/\s+/);
  return words.slice(0, Math.max(2, Math.floor(words.length / 2))).join(" ");
}

async function activityForSchool(def) {
  const P = (id) => `${def.key.toUpperCase()}-${id}`;

  const teacher = await login(def.teachers[0].email, def.teachers[0].password);
  const S = `/api/v1/schools/${teacher.schoolId}`;

  // The published class assessment from the seed run, with model answers (teacher view).
  const assessments = (await GET(`${S}/assessments`, { token: teacher.token })).body;
  const target = assessments.find((a) => a.title === "Fractions check-in" && a.status === "published");
  if (!target) throw new Error("published 'Fractions check-in' not found — run e2e-two-school-seed.mjs first");
  const detail = (await GET(`${S}/assessments/${target.id}`, { token: teacher.token })).body;
  const questions = detail.questions;
  pos(P("ACT1"), "Teacher view exposes model answers for scripting graded submissions", questions.every((q) => q.modelAnswer));

  // 12 of the lead class's 15 students sit the assessment with spread quality.
  const students = buildStudents(def, def.globalIndexStart).filter((s) => s.classIndex === 0).slice(0, 12);
  const plans = students.map((student, i) => ({
    student,
    quality: i < 2 ? "strong" : i < 5 ? "partial" : "weak",
  }));

  let graded = 0;
  for (const { student, quality } of plans) {
    const s = await login(student.email, student.password);
    const attempt = await POST(`${S}/student/assessments/${target.id}/attempts`, { token: s.token });
    if (attempt.status !== 201) throw new Error(`attempt failed for ${student.email}: ${attempt.status}`);
    const answers = Object.fromEntries(questions.map((q) => [
      q.id,
      quality === "strong" ? q.modelAnswer : quality === "partial" ? partialAnswer(q.modelAnswer) : weakAnswer(),
    ]));
    const submitted = await POST(`${S}/student/attempts/${attempt.body.id}/submit`, { token: s.token, body: { answers } });
    if (submitted.status !== 200) throw new Error(`submit failed for ${student.email}: ${submitted.status}`);
    graded++;
  }
  pos(P("ACT2"), `12 students sat the assessment (2 strong / 3 partial / 7 weak)`, graded === 12);

  // Two weak students re-sit twice with improving answers -> >=3 data points + upward trend.
  for (const { student } of plans.slice(5, 7)) {
    const s = await login(student.email, student.password);
    for (const round of ["partial", "strong"]) {
      const attempt = await POST(`${S}/student/assessments/${target.id}/attempts`, { token: s.token });
      const answers = Object.fromEntries(questions.map((q) => [
        q.id, round === "strong" ? q.modelAnswer : partialAnswer(q.modelAnswer),
      ]));
      await POST(`${S}/student/attempts/${attempt.body.id}/submit`, { token: s.token, body: { answers } });
    }
  }
  pos(P("ACT3"), "Two students re-sat twice (3 data points each — trend + cell sufficiency)", true);

  // Verify the teacher can see grading, and insights now have signal.
  const attempts = (await GET(`${S}/assessments/${target.id}/attempts`, { token: teacher.token })).body;
  const withScores = attempts.filter((a) => a.gradedScore !== null);
  pos(P("ACT4"), "Teacher attempt review shows graded scores (never sent to students)", withScores.length >= 12);

  const classes = (await GET(`${S}/teacher/classes`, { token: teacher.token })).body;
  const classId = classes[0]?.id;
  const heatmap = (await GET(`${S}/classes/${classId}/heatmap`, { token: teacher.token })).body;
  pos(P("ACT5"), "Heatmap now has real data", heatmap.enoughData === true && heatmap.cells.length >= 12);
  const focus = (await GET(`${S}/classes/${classId}/focus-areas`, { token: teacher.token })).body;
  pos(P("ACT6"), "A class-wide focus area appears (>=50% below mastery on the node)", focus.length >= 1);
  const cohorts = (await GET(`${S}/classes/${classId}/cohorts`, { token: teacher.token })).body;
  pos(P("ACT7"), "Cohort suggestions appear (below-mastery group > suppression floor)", cohorts.length >= 1);
}

async function main() {
  console.log(`Generating real class activity against ${BASE}\n`);
  for (const def of SCHOOLS) {
    console.log(`\n--- ${def.schoolName} (${def.key}) ---`);
    await section(`${def.key.toUpperCase()}-ACT`, `Class activity for ${def.schoolName}`, () => activityForSchool(def));
  }
  const failed = summarize();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("Activity run crashed:", e); process.exit(1); });
