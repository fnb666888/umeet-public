import {
  KnowledgeContentSchema,
  type KnowledgePage,
  type KnowledgeSearchInput,
} from '../../../../../packages/contracts/src/knowledge.js';
import type { KnowledgeDb } from './knowledge-core.js';
import { aliasName } from './knowledge-core.js';
export class KnowledgeReadService {
  constructor(private readonly db: KnowledgeDb) {}
  private published() {
    return this.db
      .selectFrom('knowledge_pages as p')
      .innerJoin('knowledge_revisions as r', 'r.id', 'p.current_revision_id')
      .innerJoin('users as u', 'u.id', 'r.author_id')
      .where('p.hidden', '=', 0)
      .where('p.purged', '=', 0);
  }
  async readPublished(pageId: string): Promise<KnowledgePage | null> {
    const r = await this.published()
      .select([
        'p.id',
        'p.paused',
        'r.id as revisionId',
        'r.title',
        'r.summary',
        'r.markdown',
        'r.template',
        'r.relations',
        'r.change_note',
        'r.base_revision_id',
        'r.author_id',
        'r.created_at',
        'u.nickname',
      ])
      .where('p.id', '=', pageId)
      .executeTakeFirst();
    if (!r) return null;
    return {
      ...KnowledgeContentSchema.parse({
        title: r.title,
        summary: r.summary,
        markdown: r.markdown,
        template: r.template,
        relations: JSON.parse(r.relations) as unknown,
        changeNote: r.change_note,
        baseRevisionId: r.base_revision_id,
      }),
      id: r.id,
      revisionId: r.revisionId,
      authorId: r.author_id,
      authorAlias: r.nickname,
      createdAt: r.created_at.toISOString(),
      paused: !!r.paused,
    };
  }
  async search(input: KnowledgeSearchInput) {
    let q = this.published().select(['p.id']);
    if (input.q)
      q = q.where((eb) =>
        eb.or([
          eb('r.title', 'like', '%' + input.q + '%'),
          eb('r.summary', 'like', '%' + input.q + '%'),
          eb('r.markdown', 'like', '%' + input.q + '%'),
          eb.exists(
            eb
              .selectFrom('knowledge_aliases as a')
              .select('a.page_id')
              .whereRef('a.page_id', '=', 'p.id')
              .where('a.name', 'like', '%' + aliasName(input.q) + '%'),
          ),
        ]),
      );
    if (input.cursor) q = q.where('p.id', '>', input.cursor);
    const rows = await q
      .orderBy('p.id')
      .limit(input.limit + 1)
      .execute();
    const more = rows.length > input.limit;
    const items = (
      await Promise.all(rows.slice(0, input.limit).map((p) => this.readPublished(p.id)))
    ).filter((p): p is KnowledgePage => p !== null);
    return { items, nextCursor: more ? rows[input.limit - 1]!.id : null };
  }
  async resolveTitle(title: string) {
    const rows = await this.db
      .selectFrom('knowledge_aliases as a')
      .innerJoin('knowledge_pages as p', 'p.id', 'a.page_id')
      .select('a.page_id')
      .where('a.name', '=', aliasName(title))
      .where('p.hidden', '=', 0)
      .where('p.purged', '=', 0)
      .where('p.current_revision_id', 'is not', null)
      .execute();
    return { pageIds: [...new Set(rows.map((r) => r.page_id))] };
  }
  async history(pageId: string) {
    if (!(await this.readPublished(pageId))) return [];
    return this.db
      .selectFrom('knowledge_revisions as r')
      .innerJoin('users as u', 'u.id', 'r.author_id')
      .select([
        'r.id',
        'r.title',
        'r.change_note as changeNote',
        'r.created_at as createdAt',
        'u.nickname as authorAlias',
      ])
      .where('r.page_id', '=', pageId)
      .orderBy('r.created_at', 'desc')
      .orderBy('r.id')
      .execute();
  }
  async revision(pageId: string, revisionId: string) {
    if (!(await this.readPublished(pageId))) return null;
    const r = await this.db
      .selectFrom('knowledge_revisions')
      .selectAll()
      .where('page_id', '=', pageId)
      .where('id', '=', revisionId)
      .executeTakeFirst();
    return r
      ? {
          id: r.id,
          title: r.title,
          markdown: r.markdown,
          summary: r.summary,
          template: r.template,
          relations: KnowledgeContentSchema.shape.relations.parse(
            JSON.parse(r.relations) as unknown,
          ),
          changeNote: r.change_note,
          createdAt: r.created_at.toISOString(),
        }
      : null;
  }
}
