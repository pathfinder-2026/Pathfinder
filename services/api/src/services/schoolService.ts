import { ConfirmationRequiredError, NotFoundError, ValidationError } from "../domain/errors";
import type {
  AcademicYear,
  Campus,
  ClassRoom,
  School,
  SchoolSettings,
  Term,
} from "../domain/types";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId, newToken } from "../platform/ids";
import type { DataStore } from "../ports/dataStore";

export interface TermInput {
  name: string;
  startDate: string;
  endDate: string;
}

export interface AcademicYearInput {
  name: string;
  terms: TermInput[];
}

export interface CreateSchoolInput {
  name: string;
  campusName: string;
  academicYear: AcademicYearInput;
  settings?: Partial<SchoolSettings>;
  /** Set true to proceed past a duplicate-name warning. */
  confirmDuplicate?: boolean;
}

export interface CreateSchoolResult {
  school: School;
  campus: Campus;
  academicYear: AcademicYear;
  terms: Term[];
}

export interface AddCampusInput {
  name: string;
  /** A campus may optionally have its own academic year/terms. */
  academicYear?: AcademicYearInput;
  settingsOverride?: Partial<SchoolSettings>;
}

const DEFAULT_SETTINGS: SchoolSettings = {
  timezone: "Australia/Sydney",
  defaultCurriculum: "NSW",
};

/** FR-ADM-001 — create a school; manage campuses, academic years and terms. */
export class SchoolService {
  constructor(
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  async createSchool(input: CreateSchoolInput, actorId: string | null = null): Promise<CreateSchoolResult> {
    const name = input.name?.trim();
    if (!name) throw new ValidationError("School name is required.");
    if (!input.campusName?.trim()) {
      throw new ValidationError("At least one campus is required.");
    }
    // Validate terms BEFORE any writes so nothing is half-created.
    validateTerms(input.academicYear.terms);

    // Duplicate school name: warn and require confirmation (not a hard block).
    const existing = await this.store.findSchoolByName(name);
    if (existing && !input.confirmDuplicate) {
      throw new ConfirmationRequiredError(
        "DUPLICATE_SCHOOL_NAME",
        `A school named "${name}" already exists. Confirm to create another.`,
        newToken(8),
      );
    }

    const now = this.clock.isoNow();
    const settings: SchoolSettings = { ...DEFAULT_SETTINGS, ...input.settings };

    const school: School = {
      id: newId(),
      name,
      settings,
      configComplete: false,
      createdAt: now,
    };
    await this.store.insertSchool(school);

    const campus: Campus = {
      id: newId(),
      schoolId: school.id,
      name: input.campusName.trim(),
      settings: { ...settings },
      setupComplete: true,
      createdAt: now,
    };
    await this.store.insertCampus(campus);

    const year: AcademicYear = {
      id: newId(),
      schoolId: school.id,
      campusId: null, // school-global year
      name: input.academicYear.name,
    };
    await this.store.insertAcademicYear(year);
    const terms = await this.persistTerms(year.id, input.academicYear.terms);

    this.audit.append({
      action: "school.created",
      actorId,
      subjectType: "school",
      subjectId: school.id,
      metadata: { campusId: campus.id, academicYearId: year.id, termCount: terms.length },
    });

    return { school, campus, academicYear: year, terms };
  }

  async addCampus(
    schoolId: string,
    input: AddCampusInput,
    actorId: string | null = null,
  ): Promise<{ campus: Campus; academicYear: AcademicYear | null; terms: Term[] }> {
    const school = await this.store.getSchool(schoolId);
    if (!school) throw new NotFoundError("School not found.");
    if (!input.name?.trim()) throw new ValidationError("Campus name is required.");

    // A campus with its own academic year is validated up front.
    if (input.academicYear) validateTerms(input.academicYear.terms);

    // Inherit the school's global settings; a campus may override them.
    const settings: SchoolSettings = { ...school.settings, ...input.settingsOverride };

    const campus: Campus = {
      id: newId(),
      schoolId,
      name: input.name.trim(),
      settings,
      // Still "being set up" until it has a valid academic year of its own or
      // is explicitly configured against the school-global one.
      setupComplete: Boolean(input.academicYear),
      createdAt: this.clock.isoNow(),
    };
    await this.store.insertCampus(campus);

    let year: AcademicYear | null = null;
    let terms: Term[] = [];
    if (input.academicYear) {
      year = {
        id: newId(),
        schoolId,
        campusId: campus.id,
        name: input.academicYear.name,
      };
      await this.store.insertAcademicYear(year);
      terms = await this.persistTerms(year.id, input.academicYear.terms);
    }

    this.audit.append({
      action: "campus.added",
      actorId,
      subjectType: "campus",
      subjectId: campus.id,
      metadata: { schoolId, inheritedSettings: true, ownAcademicYear: Boolean(year) },
    });

    return { campus, academicYear: year, terms };
  }

  /** Create a class within a campus (the single class of the M0 thin slice). */
  async createClass(
    schoolId: string,
    campusId: string,
    name: string,
    actorId: string | null = null,
    yearGroup: string | null = null,
    /** Subject taught — with yearGroup this picks the class's curriculum graph. */
    subject: string | null = null,
  ): Promise<ClassRoom> {
    const school = await this.store.getSchool(schoolId);
    if (!school) throw new NotFoundError("School not found.");
    const campus = await this.store.getCampus(campusId);
    if (!campus || campus.schoolId !== schoolId) {
      throw new NotFoundError("Campus not found in this school.");
    }
    if (!name?.trim()) throw new ValidationError("Class name is required.");
    const klass: ClassRoom = {
      id: newId(),
      schoolId,
      campusId,
      name: name.trim(),
      yearGroup,
      subject: subject?.trim() || null,
      createdAt: this.clock.isoNow(),
    };
    await this.store.insertClass(klass);
    this.audit.append({
      action: "class.created",
      actorId,
      subjectType: "class",
      subjectId: klass.id,
      metadata: { schoolId, campusId, subject: klass.subject, yearGroup },
    });
    return klass;
  }

  private async persistTerms(academicYearId: string, inputs: TermInput[]): Promise<Term[]> {
    const terms: Term[] = [];
    for (const t of inputs) {
      const term: Term = {
        id: newId(),
        academicYearId,
        name: t.name,
        startDate: t.startDate,
        endDate: t.endDate,
      };
      await this.store.insertTerm(term);
      terms.push(term);
    }
    return terms;
  }
}

/** Term dates must be present and end strictly after start. */
export function validateTerms(terms: TermInput[]): void {
  if (!terms || terms.length === 0) {
    throw new ValidationError("At least one term is required.");
  }
  for (const t of terms) {
    if (!t.startDate || !t.endDate) {
      throw new ValidationError(`Term "${t.name}" must have both a start and end date.`);
    }
    if (new Date(t.endDate).getTime() <= new Date(t.startDate).getTime()) {
      throw new ValidationError(`Term "${t.name}" end date must be after its start date.`);
    }
  }
}
