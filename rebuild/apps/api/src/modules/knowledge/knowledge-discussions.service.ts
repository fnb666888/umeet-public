import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import { type KnowledgeDb, knowledgeWrite } from './knowledge-core.js';
import { KnowledgeAccess } from './knowledge-access.js';
import { KnowledgeReadService } from './knowledge-read.service.js';
export class KnowledgeDiscussionsService {
  constructor(private readonly db: KnowledgeDb) {}
  async list(pageId: string) {
    if (!(await new KnowledgeReadService(this.db).readPublished(pageId))) return [];
    return this.db
      .selectFrom('knowledge_discussions as d')
      .innerJoin('users as u', 'u.id', 'd.author_id')
      .select([
        'd.id',
        'd.page_id as pageId',
        'd.body',
        'd.created_at as createdAt',
        'u.nickname as authorAlias',
      ])
      .where('d.page_id', '=', pageId)
      .orderBy('d.created_at')
      .limit(200)
      .execute();
  }
  async add(ctx: RequestContext, pageId: string, body: string) {
    const text = z.string().trim().min(1).max(8000).parse(body);
    return knowledgeWrite(this.db, async (tx) => {
      const actor = await new KnowledgeAccess(tx).member(ctx);
      if (!(await new KnowledgeReadService(tx).readPublished(pageId)))
        throw new NotFoundException('KNOWLEDGE_UNAVAILABLE');
      const id = randomUUID();
      await tx
        .insertInto('knowledge_discussions')
        .values({
          id,
          page_id: pageId,
          author_id: actor.userId,
          body: text,
          created_at: new Date(),
        })
        .execute();
      return { id };
    });
  }
}
