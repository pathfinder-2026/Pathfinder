import {
  scoreGraphMatch,
  type ContentMapping,
  type GraphScope,
  type PrerequisiteEdge,
  type SkillGraphVersion,
  type SkillNode,
} from "../../domain/skillGraph";
import type { SchoolCurriculum, SkillGraphStore } from "../../ports/skillGraphStore";
import { iso, isoOrNull, type Sql } from "./pgClient";

/** PostgreSQL SkillGraphStore adapter (ap-southeast-2). */
export class PgSkillGraphStore implements SkillGraphStore {
  constructor(private readonly sql: Sql) {}

  async insertGraphVersion(v: SkillGraphVersion): Promise<void> {
    await this.sql`insert into skill_graph_versions (id,name,curriculum,version,status,signed_off_by,signed_off_at,created_at,subject,year_level)
      values (${v.id},${v.name},${v.curriculum},${v.version},${v.status},${v.signedOffBy},${v.signedOffAt},${v.createdAt},${v.subject},${v.yearLevel})`;
  }
  async getGraphVersion(id: string): Promise<SkillGraphVersion | undefined> {
    return mapVersion((await this.sql`select * from skill_graph_versions where id=${id}`)[0]);
  }
  async updateGraphVersion(v: SkillGraphVersion): Promise<void> {
    await this.sql`update skill_graph_versions set status=${v.status}, signed_off_by=${v.signedOffBy},
      signed_off_at=${v.signedOffAt} where id=${v.id}`;
  }
  async listGraphVersions(): Promise<SkillGraphVersion[]> {
    return (await this.sql`select * from skill_graph_versions`).map(mapVersion) as SkillGraphVersion[];
  }
  async listSignedOffVersions(curriculum: string): Promise<SkillGraphVersion[]> {
    return (await this.sql`select * from skill_graph_versions where curriculum=${curriculum} and status='signed_off'
      order by created_at desc`).map(mapVersion) as SkillGraphVersion[];
  }
  async latestSignedOffVersion(curriculum: string, scope?: GraphScope): Promise<SkillGraphVersion | undefined> {
    // Scope fitting lives in the domain (scoreGraphMatch) so both adapters — and
    // the tests that run the whole suite against each — agree on the rule.
    return (await this.listSignedOffVersions(curriculum))
      .map((v) => ({ v, score: scoreGraphMatch(v, scope) }))
      .filter((c) => c.score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.v;
  }

  async insertNode(versionId: string, n: SkillNode): Promise<void> {
    await this.sql`insert into skill_nodes (graph_version_id,id,type,label,code,parent_id,curriculum,foundational)
      values (${versionId},${n.id},${n.type},${n.label},${n.code ?? null},${n.parentId},${n.curriculum},${n.foundational ?? false})`;
  }
  async getNode(versionId: string, nodeId: string): Promise<SkillNode | undefined> {
    return mapNode((await this.sql`select * from skill_nodes where graph_version_id=${versionId} and id=${nodeId}`)[0]);
  }
  async listNodes(versionId: string): Promise<SkillNode[]> {
    return (await this.sql`select * from skill_nodes where graph_version_id=${versionId}`).map(mapNode) as SkillNode[];
  }
  async insertEdge(versionId: string, e: PrerequisiteEdge): Promise<void> {
    await this.sql`insert into skill_prerequisites (graph_version_id,from_node,to_node)
      values (${versionId},${e.from},${e.to}) on conflict do nothing`;
  }
  async listEdges(versionId: string): Promise<PrerequisiteEdge[]> {
    return (await this.sql`select * from skill_prerequisites where graph_version_id=${versionId}`).map(
      (r) => ({ from: r.from_node, to: r.to_node }),
    );
  }

  async insertMapping(m: ContentMapping): Promise<void> {
    await this.sql`insert into content_mappings
      (id,graph_version_id,content_item_id,node_id,source,difficulty,overridden_from_node_id,flags,created_at)
      values (${m.id},${m.graphVersionId},${m.contentItemId},${m.nodeId},${m.source},${m.difficulty},
        ${m.overriddenFromNodeId},${this.sql.json(m.flags)},${m.createdAt})`;
  }
  async getMapping(id: string): Promise<ContentMapping | undefined> {
    return mapMapping((await this.sql`select * from content_mappings where id=${id}`)[0]);
  }
  async updateMapping(m: ContentMapping): Promise<void> {
    await this.sql`update content_mappings set node_id=${m.nodeId}, source=${m.source}, difficulty=${m.difficulty},
      overridden_from_node_id=${m.overriddenFromNodeId}, flags=${this.sql.json(m.flags)} where id=${m.id}`;
  }
  async deleteMapping(id: string): Promise<void> {
    await this.sql`delete from content_mappings where id=${id}`;
  }
  async listMappingsByContent(contentItemId: string): Promise<ContentMapping[]> {
    return (await this.sql`select * from content_mappings where content_item_id=${contentItemId}`).map(mapMapping) as ContentMapping[];
  }
  async listMappingsByVersion(versionId: string): Promise<ContentMapping[]> {
    return (await this.sql`select * from content_mappings where graph_version_id=${versionId}`).map(mapMapping) as ContentMapping[];
  }

  async setSchoolCurriculum(c: SchoolCurriculum): Promise<void> {
    await this.sql`insert into school_curricula (school_id,curriculum,custom_outcomes_defined)
      values (${c.schoolId},${c.curriculum},${c.customOutcomesDefined})
      on conflict (school_id) do update set curriculum=${c.curriculum}, custom_outcomes_defined=${c.customOutcomesDefined}`;
  }
  async getSchoolCurriculum(schoolId: string): Promise<SchoolCurriculum | undefined> {
    const r = (await this.sql`select * from school_curricula where school_id=${schoolId}`)[0];
    return r ? { schoolId: r.school_id, curriculum: r.curriculum, customOutcomesDefined: r.custom_outcomes_defined } : undefined;
  }

  async recordMastery(contentItemId: string, nodeId: string): Promise<void> {
    await this.sql`insert into skill_mastery_refs (content_item_id,node_id) values (${contentItemId},${nodeId})
      on conflict do nothing`;
  }
  async masteryExists(contentItemId: string, nodeId: string): Promise<boolean> {
    const r = (await this.sql`select 1 from skill_mastery_refs where content_item_id=${contentItemId} and node_id=${nodeId}`)[0];
    return Boolean(r);
  }
}

type Row = Record<string, any> | undefined;

function mapVersion(r: Row): SkillGraphVersion | undefined {
  return r && {
    id: r.id,
    name: r.name,
    curriculum: r.curriculum,
    version: r.version,
    status: r.status,
    signedOffBy: r.signed_off_by,
    signedOffAt: isoOrNull(r.signed_off_at),
    createdAt: iso(r.created_at),
    subject: r.subject ?? null,
    yearLevel: r.year_level == null ? null : Number(r.year_level),
  };
}
function mapNode(r: Row): SkillNode | undefined {
  return r && {
    id: r.id,
    type: r.type,
    label: r.label,
    code: r.code ?? undefined,
    parentId: r.parent_id,
    curriculum: r.curriculum,
    foundational: r.foundational,
  };
}
function mapMapping(r: Row): ContentMapping | undefined {
  return r && {
    id: r.id,
    graphVersionId: r.graph_version_id,
    contentItemId: r.content_item_id,
    nodeId: r.node_id,
    source: r.source,
    difficulty: r.difficulty,
    overriddenFromNodeId: r.overridden_from_node_id,
    flags: r.flags,
    createdAt: iso(r.created_at),
  };
}
