import { buildContext, type AppContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import { newId } from "../src/platform/ids";
import type { User } from "../src/domain/types";

export interface TestHarness {
  ctx: AppContext;
  clock: FixedClock;
}

/** Build an app context backed by the in-memory store and a deterministic clock. */
export function makeHarness(): TestHarness {
  const clock = new FixedClock();
  const ctx = buildContext({ clock });
  return { ctx, clock };
}

export const VALID_YEAR = {
  name: "2026",
  terms: [
    { name: "Term 1", startDate: "2026-01-28", endDate: "2026-04-10" },
    { name: "Term 2", startDate: "2026-04-27", endDate: "2026-07-03" },
  ],
};

/** Seed a school + one Admin. Returns the created entities. */
export function seedSchoolWithAdmin(ctx: AppContext, name = "Springfield High") {
  const created = ctx.schools.createSchool({
    name,
    campusName: "Main Campus",
    academicYear: VALID_YEAR,
  });
  const admin = ctx.accounts.createAccount({
    schoolId: created.school.id,
    role: "admin",
    email: `admin@${slug(name)}.edu`,
    firstName: "Ada",
    lastName: "Admin",
  });
  return { ...created, admin };
}

/** Insert a plain user (with PII) and no membership; caller adds memberships. */
export function makeUser(ctx: AppContext, schoolId: string, email: string): User {
  const user: User = { id: newId(), schoolId, status: "active", createdAt: ctx.clock.isoNow() };
  ctx.store.insertUser(user);
  ctx.store.upsertPersonalData({ userId: user.id, email, firstName: "Test", lastName: "User" });
  return user;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
