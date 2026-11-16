import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import type { DocumentAst } from '../../../../../packages/markdown/src/parse.js';
import { extractWikiLinks } from '../../../../../packages/markdown/src/links.js';
import { NotFoundException } from '@nestjs/common';
export class WikiLinksService {
  constructor(private readonly db: Kysely<Database>) {}
  async record(
    tx: Transaction<Database>,
    revisionId: string,
    pageId: string,
    communitySlug: string,
    ast: DocumentAst,
  ): Promise<void> {
    const references = extractWikiLinks(ast, communitySlug);
    if (references.length)
      await tx
        .insertInto('wiki_links')
        .values(
          references.map((link) => ({
            revision_id: revisionId,
            source_page_id: pageId,
            target_community_slug: link.communitySlug,
            target_slug: link.slug,
            label: link.label.slice(0, 200),
          })),
        )
        .execute();
  }
  async listBacklinks(
    pageId: string,
  ): Promise<{ pageId: string; title: string; communitySlug: string }[]> {
    const target = await this.db
      .selectFrom('wiki_pages')
      .innerJoin('communities', 'communities.id', 'wiki_pages.community_id')
      .select(['wiki_pages.slug', 'communities.slug as community_slug'])
      .where('wiki_pages.id', '=', pageId)
      .executeTakeFirst();
    if (!target) throw new NotFoundException('WIKI_PAGE_NOT_FOUND');
    const rows = await this.db
      .selectFrom('wiki_links')
      .innerJoin('wiki_pages', 'wiki_pages.current_revision_id', 'wiki_links.revision_id')
      .innerJoin('wiki_revisions', 'wiki_revisions.id', 'wiki_links.revision_id')
      .innerJoin('communities', 'communities.id', 'wiki_pages.community_id')
      .select([
        'wiki_pages.id as pageId',
        'wiki_revisions.title',
        'communities.slug as communitySlug',
      ])
      .where('target_community_slug', '=', target.community_slug)
      .where('target_slug', '=', target.slug)
      .where('wiki_revisions.visibility', '=', 'public')
      .orderBy('wiki_pages.id', 'asc')
      .execute();
    return rows;
  }
}
