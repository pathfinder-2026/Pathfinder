/**
 * Appendix (Milestone A) — CSV bulk-import domain (FR-ADM-003).
 *
 * Pure parsing, validation and spreadsheet-injection sanitisation. The service
 * (CsvImportService) drives account creation on top of these; keeping the logic
 * here makes every edge case (malformed rows, duplicate emails, formula
 * injection) directly unit-testable.
 */

import type { Role } from "./types";

/** Roles that may be created via CSV import. */
export const IMPORTABLE_ROLES: Role[] = ["student", "teacher", "parent", "principal"];

/**
 * Characters that trigger formula evaluation when a spreadsheet opens a CSV
 * (FR-ADM-003, NEW v1.4). A cell beginning with any of these is neutralised.
 */
export const FORMULA_TRIGGERS = ["=", "+", "-", "@"] as const;

/**
 * True if `value` would be interpreted as a formula by Excel/Sheets. We also
 * look past a leading tab/CR/LF, which spreadsheets strip before evaluating
 * (OWASP CSV-injection guidance).
 */
export function isFormulaInjection(value: string): boolean {
  const stripped = value.replace(/^[\t\r\n ]+/, "");
  return stripped.length > 0 && (FORMULA_TRIGGERS as readonly string[]).includes(stripped[0]!);
}

/**
 * Neutralise a cell so no downstream export or spreadsheet view can evaluate it:
 * prefix a single quote, which spreadsheets treat as "this is literal text".
 * Idempotent — a value that is already inert (or not a trigger) is returned
 * unchanged, so it is safe to apply again at export time (defence in depth).
 */
export function sanitiseCell(value: string): string {
  return isFormulaInjection(value) ? `'${value}` : value;
}

/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes (""),
 * embedded commas/newlines inside quotes, and CRLF. Returns rows of raw strings.
 * Blank trailing lines are ignored.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush the last field/row unless the input ended exactly on a newline.
  if (field.length > 0 || row.length > 0) pushRow();
  // Drop fully-empty rows (e.g. a trailing blank line that still produced [""]).
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
}

/** Canonical header names and the aliases we accept for each. */
const HEADER_ALIASES: Record<string, string> = {
  firstname: "firstName",
  first_name: "firstName",
  "first name": "firstName",
  lastname: "lastName",
  last_name: "lastName",
  "last name": "lastName",
  email: "email",
  "email address": "email",
  role: "role",
  class: "class",
  classname: "class",
  class_name: "class",
  "class name": "class",
};

export const REQUIRED_COLUMNS = ["firstName", "lastName", "email", "role", "class"] as const;

/** Map a raw header row to canonical column keys (index-aligned). */
export function canonicalHeaders(rawHeader: string[]): string[] {
  return rawHeader.map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? h.trim());
}

export interface ParsedRow {
  /** 1-based line number in the file (header is line 1; first data row is 2). */
  line: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  class: string;
  /** True if any cell was a formula-injection attempt and has been sanitised. */
  flaggedForReview: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RowValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a parsed row's field values (presence, role, email shape). Duplicate
 * detection and class resolution need the store, so they live in the service.
 */
export function validateRow(row: ParsedRow): RowValidation {
  const errors: string[] = [];
  if (!row.firstName.trim()) errors.push("missing required field 'firstName'");
  if (!row.lastName.trim()) errors.push("missing required field 'lastName'");
  if (!row.email.trim()) errors.push("missing required field 'email'");
  else if (!EMAIL_RE.test(row.email.trim())) errors.push(`invalid email '${row.email}'`);
  if (!row.role.trim()) errors.push("missing required field 'role'");
  else if (!(IMPORTABLE_ROLES as string[]).includes(row.role.trim().toLowerCase())) {
    errors.push(`invalid role '${row.role}'`);
  }
  if (!row.class.trim()) errors.push("missing required field 'class'");
  return { ok: errors.length === 0, errors };
}

// ---- import result shape ----

export interface ImportedRow {
  line: number;
  userId: string;
  email: string;
  role: Role;
  classId: string;
  /** Sanitised formula-injection cell(s); the account exists but needs review. */
  flaggedForReview: boolean;
}

export interface RejectedRow {
  line: number;
  /** One specific reason per problem, so the Admin can fix that exact row. */
  errors: string[];
}

export interface DuplicateRow {
  line: number;
  email: string;
}

export interface CsvImportResult {
  totalRows: number;
  imported: ImportedRow[];
  rejected: RejectedRow[];
  duplicates: DuplicateRow[];
  /** Count of imported rows that were flagged for review (formula injection). */
  flaggedForReview: number;
}

/** Serialise rows back to a CSV line, sanitising every cell (export safety). */
export function toCsvLine(cells: string[]): string {
  return cells
    .map((c) => {
      const safe = sanitiseCell(c);
      return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    })
    .join(",");
}
