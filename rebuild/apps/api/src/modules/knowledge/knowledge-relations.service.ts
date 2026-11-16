import { BadRequestException } from '@nestjs/common';
import type { KnowledgeRelationInput } from '../../../../../packages/contracts/src/knowledge.js';
import { type KnowledgeDb } from './knowledge-core.js';
import { KnowledgeReadService } from './knowledge-read.service.js';
export class KnowledgeRelationsService {
  constructor(private readonly db: KnowledgeDb) {}
  async validate(pageId: string, relations: KnowledgeRelationInput[]) {
    const seen = new Set<string>();
    for (const r of relations) {
      const key = r.type + ':' + r.targetPageId;
      if (r.targetPageId === pageId || seen.has(key))
        throw new BadRequestException('INVALID_RELATION');
      seen.add(key);
      if (!(await new KnowledgeReadService(this.db).readPublished(r.targetPageId)))
        throw new BadRequestException('RELATION_TARGET_UNAVAILABLE');
    }
    const rows = await this.db
      .selectFrom('knowledge_revision_relations as r')
      .innerJoin('knowledge_pages as p', 'p.current_revision_id', 'r.revision_id')
      .select(['r.source_page_id', 'r.target_page_id'])
      .where('r.kind', '=', 'prerequisite')
      .where('p.purged', '=', 0)
      .where('r.source_page_id', '!=', pageId)
      .execute();
    const edges = new Map<string, string[]>();
    for (const r of rows)
      edges.set(r.source_page_id, [...(edges.get(r.source_page_id) ?? []), r.target_page_id]);
    edges.set(
      pageId,
      relations.filter((r) => r.type === 'prerequisite').map((r) => r.targetPageId),
    );
    const active = new Set<string>(),
      done = new Set<string>();
    const visit = (id: string) => {
      if (active.has(id)) throw new BadRequestException('PREREQUISITE_CYCLE');
      if (done.has(id)) return;
      active.add(id);
      for (const next of edges.get(id) ?? []) visit(next);
      active.delete(id);
      done.add(id);
    };
    visit(pageId);
  }
  async listPublished(pageId: string) {
    const read = new KnowledgeReadService(this.db);
    const page = await read.readPublished(pageId);
    if (!page) return { outgoing: [], incoming: [] };
    const outgoing = await Promise.all(
      page.relations.map(async (r) => ({
        ...r,
        available: !!(await read.readPublished(r.targetPageId)),
      })),
    );
    const rows = await this.db
      .selectFrom('knowledge_revision_relations as r')
      .innerJoin('knowledge_pages as p', 'p.current_revision_id', 'r.revision_id')
      .select(['r.source_page_id', 'r.kind', 'r.conditions', 'r.explanation', 'r.evidence'])
      .where('r.target_page_id', '=', pageId)
      .where('p.hidden', '=', 0)
      .where('p.purged', '=', 0)
      .execute();
    return {
      outgoing,
      incoming: rows.map((r) => ({
        sourcePageId: r.source_page_id,
        relation: {
          type: r.kind,
          targetPageId: pageId,
          conditions: r.conditions,
          explanation: r.explanation,
          evidence: r.evidence,
        },
      })),
    };
  }
}
