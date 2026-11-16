import type { Nodes } from 'mdast';
import { parseMarkdown } from '../../../../../packages/markdown/src/parse.js';
import type { KnowledgeDb } from './knowledge-core.js';
import { KnowledgeReadService } from './knowledge-read.service.js';
export class KnowledgeLinksService {
  constructor(private readonly db: KnowledgeDb) {}
  async index(revisionId: string, sourcePageId: string, markdown: string) {
    const ids = new Set<string>();
    const visit = (node: Nodes) => {
      if (node.type === 'link') {
        const match = /^\/knowledge\/([a-zA-Z0-9_-]+)(?:#.*)?$/.exec(node.url);
        if (match?.[1]) ids.add(match[1]);
      }
      if ('children' in node) for (const child of node.children) visit(child);
    };
    visit(parseMarkdown(markdown));
    for (const target of ids) {
      const p = await this.db
        .selectFrom('knowledge_pages')
        .select(['current_revision_id', 'purged'])
        .where('id', '=', target)
        .executeTakeFirst();
      if (p?.current_revision_id || p?.purged)
        await this.db
          .insertInto('knowledge_links')
          .values({ revision_id: revisionId, source_page_id: sourcePageId, target_page_id: target })
          .execute();
    }
  }
  async backlinks(pageId: string) {
    if (!(await new KnowledgeReadService(this.db).readPublished(pageId))) return [];
    return this.db
      .selectFrom('knowledge_links as l')
      .innerJoin('knowledge_pages as p', 'p.current_revision_id', 'l.revision_id')
      .innerJoin('knowledge_revisions as r', 'r.id', 'p.current_revision_id')
      .select(['p.id as pageId', 'r.title'])
      .where('l.target_page_id', '=', pageId)
      .where('p.hidden', '=', 0)
      .where('p.purged', '=', 0)
      .distinct()
      .limit(100)
      .execute();
  }
}
