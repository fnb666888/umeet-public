import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { NotFoundException } from '@nestjs/common';
import { parseMarkdown } from '../../../../../packages/markdown/src/parse.js';
import { extractAttachments } from '../../../../../packages/markdown/src/links.js';
import type { RevisionDiff } from '../../../../../packages/contracts/src/index.js';
export class WikiDiffService {
  constructor(private readonly db: Kysely<Database>) {}
  async getRevisionDiff(fromId: string, toId: string, pageId?: string): Promise<RevisionDiff> {
    const rows = await this.db
      .selectFrom('wiki_revisions')
      .select(['id', 'page_id', 'title', 'markdown'])
      .where('id', 'in', [fromId, toId])
      .where('visibility', '=', 'public')
      .execute();
    const from = rows.find((r) => r.id === fromId),
      to = rows.find((r) => r.id === toId);
    if (!from || !to || from.page_id !== to.page_id || (pageId && from.page_id !== pageId))
      throw new NotFoundException('WIKI_REVISION_NOT_FOUND');
    const a = (from.title + '\n\n' + from.markdown).split('\n'),
      b = (to.title + '\n\n' + to.markdown).split('\n');
    let prefix = 0,
      suffix = 0;
    while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++;
    while (
      suffix < Math.min(a.length, b.length) - prefix &&
      a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
    )
      suffix++;
    const blocks: RevisionDiff['blocks'] = [];
    if (prefix) blocks.push({ kind: 'equal', text: a.slice(0, prefix).join('\n') });
    if (a.length - prefix - suffix)
      blocks.push({ kind: 'removed', text: a.slice(prefix, a.length - suffix).join('\n') });
    if (b.length - prefix - suffix)
      blocks.push({ kind: 'added', text: b.slice(prefix, b.length - suffix).join('\n') });
    if (suffix) blocks.push({ kind: 'equal', text: a.slice(a.length - suffix).join('\n') });
    const before = extractAttachments(parseMarkdown(from.markdown)),
      after = extractAttachments(parseMarkdown(to.markdown));
    return {
      blocks,
      attachments: {
        added: after.filter((url) => !before.includes(url)),
        removed: before.filter((url) => !after.includes(url)),
      },
    };
  }
}
