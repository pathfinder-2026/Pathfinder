import type { ParentChildLink } from "../../domain/parent";
import type { ParentStore } from "../../ports/parentStore";
import { iso, isoOrNull, type Sql } from "./pgClient";

/** PostgreSQL ParentStore adapter (ap-southeast-2). */
export class PgParentStore implements ParentStore {
  constructor(private readonly sql: Sql) {}

  async insertLink(l: ParentChildLink): Promise<void> {
    await this.sql`insert into parent_children
      (id,school_id,parent_id,student_id,relationship,verified,verified_at,last_digest_at,created_at)
      values (${l.id},${l.schoolId},${l.parentId},${l.studentId},${l.relationship},${l.verified},
        ${l.verifiedAt},${l.lastDigestAt},${l.createdAt})`;
  }
  async updateLink(l: ParentChildLink): Promise<void> {
    await this.sql`update parent_children set relationship=${l.relationship},verified=${l.verified},
      verified_at=${l.verifiedAt},last_digest_at=${l.lastDigestAt} where id=${l.id}`;
  }
  async getLink(id: string): Promise<ParentChildLink | undefined> {
    const rows = await this.sql`select * from parent_children where id=${id}`;
    return rows[0] ? map(rows[0]) : undefined;
  }
  async findLink(parentId: string, studentId: string): Promise<ParentChildLink | undefined> {
    const rows = await this.sql`select * from parent_children where parent_id=${parentId} and student_id=${studentId}`;
    return rows[0] ? map(rows[0]) : undefined;
  }
  async listLinksByParent(parentId: string): Promise<ParentChildLink[]> {
    return (await this.sql`select * from parent_children where parent_id=${parentId}`).map(map);
  }
  async listLinksBySchool(schoolId: string): Promise<ParentChildLink[]> {
    return (await this.sql`select * from parent_children where school_id=${schoolId}`).map(map);
  }
}

function map(r: Record<string, any>): ParentChildLink {
  return {
    id: r.id, schoolId: r.school_id, parentId: r.parent_id, studentId: r.student_id,
    relationship: r.relationship, verified: r.verified, verifiedAt: isoOrNull(r.verified_at),
    lastDigestAt: isoOrNull(r.last_digest_at), createdAt: iso(r.created_at),
  };
}
