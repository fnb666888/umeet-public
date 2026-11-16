import { NotFoundException } from '@nestjs/common';
import type { RevisionDiff } from '../../../../../packages/contracts/src/index.js';
import { parseMarkdown } from '../../../../../packages/markdown/src/parse.js';
import { extractAttachments } from '../../../../../packages/markdown/src/links.js';
import type { KnowledgeDb } from './knowledge-core.js';
import { KnowledgeReadService } from './knowledge-read.service.js';
export class KnowledgeDiffService {
  constructor(private readonly db: KnowledgeDb) {}
  async diff(pageId: string, fromId: string, toId: string): Promise<RevisionDiff> {
    const reader = new KnowledgeReadService(this.db);
    const [from, to] = await Promise.all([
      reader.revision(pageId, fromId),
      reader.revision(pageId, toId),
    ]);
    if (!from || !to) throw new NotFoundException('REVISION_NOT_FOUND');
    const lines = (r: typeof from) =>
        [r.title, r.summary, r.markdown, JSON.stringify(r.relations, null, 2)]
          .join('\n\n')
          .split('\n'),
      a = lines(from),
      b = lines(to);
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
        added: after.filter((x) => !before.includes(x)),
        removed: before.filter((x) => !after.includes(x)),
      },
    };
  }
}
