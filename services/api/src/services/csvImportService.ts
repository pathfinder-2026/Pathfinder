import { ValidationError, NotFoundError } from "../domain/errors";
import type { ClassRoom, Role } from "../domain/types";
import {
  canonicalHeaders,
  parseCsv,
  REQUIRED_COLUMNS,
  sanitiseCell,
  isFormulaInjection,
  validateRow,
  toCsvLine,
  type CsvImportResult,
  type DuplicateRow,
  type ImportedRow,
  type ParsedRow,
  type RejectedRow,
} from "../domain/csvImport";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import type { DataStore } from "../ports/dataStore";
import type { AccountService } from "./accountService";

/**
 * Appendix (Milestone A) — FR-ADM-003 CSV bulk import.
 *
 * Imports users from a CSV so an Admin doesn't create hundreds of accounts by
 * hand. Every row is handled independently:
 *   - malformed rows (missing fields / bad role / bad email / unknown class) are
 *     rejected with a SPECIFIC error per row, and the valid rows still import;
 *   - a row whose email already exists (in the system or earlier in the file) is
 *     flagged a duplicate and skipped, never creating a conflicting account;
 *   - a cell that begins with =, +, - or @ is neutralised (spreadsheet-formula
 *     injection, NEW v1.4): stored as inert text and the row is flagged for review.
 */
export class CsvImportService {
  constructor(
    private readonly store: DataStore,
    private readonly accounts: AccountService,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  async importUsers(schoolId: string, csvText: string, actorId: string | null = null): Promise<CsvImportResult> {
    const school = await this.store.getSchool(schoolId);
    if (!school) throw new NotFoundError("School not found.");

    const rows = parseCsv(csvText);
    if (rows.length === 0) throw new ValidationError("The CSV file is empty.");

    const header = canonicalHeaders(rows[0]!);
    const missingCols = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
    if (missingCols.length > 0) {
      throw new ValidationError(`CSV is missing required column(s): ${missingCols.join(", ")}.`);
    }
    const col = (name: string) => header.indexOf(name);
    const idx = {
      firstName: col("firstName"),
      lastName: col("lastName"),
      email: col("email"),
      role: col("role"),
      class: col("class"),
    };

    // Resolve class assignment by name (case-insensitive) within this school.
    const classes = await this.store.listClassesBySchool(schoolId);
    const classByName = new Map<string, ClassRoom>();
    for (const k of classes) classByName.set(k.name.trim().toLowerCase(), k);

    const imported: ImportedRow[] = [];
    const rejected: RejectedRow[] = [];
    const duplicates: DuplicateRow[] = [];
    const seenEmails = new Set<string>();

    for (let r = 1; r < rows.length; r++) {
      const raw = rows[r]!;
      const line = r + 1; // header is line 1
      const cell = (i: number) => (i >= 0 && i < raw.length ? raw[i]! : "");

      // Neutralise any formula-injection cell BEFORE anything else touches the
      // value; the row still imports, but flagged for review.
      const anyInjection =
        isFormulaInjection(cell(idx.firstName)) ||
        isFormulaInjection(cell(idx.lastName)) ||
        isFormulaInjection(cell(idx.email)) ||
        isFormulaInjection(cell(idx.role)) ||
        isFormulaInjection(cell(idx.class));

      const parsed: ParsedRow = {
        line,
        firstName: sanitiseCell(cell(idx.firstName)),
        lastName: sanitiseCell(cell(idx.lastName)),
        email: sanitiseCell(cell(idx.email)),
        role: sanitiseCell(cell(idx.role)),
        class: sanitiseCell(cell(idx.class)),
        flaggedForReview: anyInjection,
      };

      const validation = validateRow(parsed);
      if (!validation.ok) {
        rejected.push({ line, errors: validation.errors });
        continue;
      }

      const emailKey = parsed.email.trim().toLowerCase();
      if (seenEmails.has(emailKey) || (await this.store.findUserIdByEmail(parsed.email.trim()))) {
        duplicates.push({ line, email: parsed.email.trim() });
        continue;
      }

      const klass = classByName.get(parsed.class.trim().toLowerCase());
      if (!klass) {
        rejected.push({ line, errors: [`unknown class '${parsed.class}'`] });
        continue;
      }

      const role = parsed.role.trim().toLowerCase() as Role;
      const { user } = await this.accounts.createAccount(
        {
          schoolId,
          role,
          email: parsed.email.trim(),
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          campusId: klass.campusId,
          classId: klass.id,
        },
        actorId,
      );
      if (role === "student") await this.accounts.enrolStudent(user.id, klass.id);

      seenEmails.add(emailKey);
      imported.push({
        line,
        userId: user.id,
        email: parsed.email.trim(),
        role,
        classId: klass.id,
        flaggedForReview: parsed.flaggedForReview,
      });
    }

    const flaggedForReview = imported.filter((i) => i.flaggedForReview).length;
    this.audit.append({
      action: "csv.import.completed",
      actorId,
      subjectType: "school",
      subjectId: schoolId,
      metadata: {
        totalRows: rows.length - 1,
        imported: imported.length,
        rejected: rejected.length,
        duplicates: duplicates.length,
        flaggedForReview,
      },
    });

    return { totalRows: rows.length - 1, imported, rejected, duplicates, flaggedForReview };
  }

  /**
   * Export the school's users as CSV. Every cell is run through the same
   * sanitiser, so a value that arrived as a formula (even if it somehow slipped
   * past import) is emitted as inert text — it is never evaluated by a
   * downstream spreadsheet (FR-ADM-003, defence in depth on the export side).
   */
  async exportUsersCsv(schoolId: string): Promise<string> {
    const users = await this.store.listUsersBySchool(schoolId);
    const classes = await this.store.listClassesBySchool(schoolId);
    const classById = new Map(classes.map((k) => [k.id, k]));
    const lines: string[] = [toCsvLine(["firstName", "lastName", "email", "role", "class"])];
    for (const u of users) {
      const pii = await this.store.getPersonalData(u.id);
      if (!pii) continue; // erased users carry no PII to export
      const memberships = await this.store.listMembershipsByUser(u.id);
      const m = memberships[0];
      const klass = m?.classId ? classById.get(m.classId) : undefined;
      lines.push(toCsvLine([pii.firstName, pii.lastName, pii.email, m?.role ?? "", klass?.name ?? ""]));
    }
    return lines.join("\n");
  }
}
