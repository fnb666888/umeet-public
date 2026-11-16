import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import {
  KnowledgeDraftSchema,
  type KnowledgeDraftInput,
} from '../../../../../packages/contracts/src/knowledge.js';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import { type KnowledgeDb, knowledgeWrite, conflict, pageRow } from './knowledge-core.js';
import { KnowledgeAccess } from './knowledge-access.js';
export class KnowledgeDraftsService {
  constructor(private readonly db: KnowledgeDb) {}
  async save(ctx: RequestContext, raw: KnowledgeDraftInput) {
    const input = KnowledgeDraftSchema.parse(raw);
    return knowledgeWrite(this.db, async (tx) => {
      const access = new KnowledgeAccess(tx),
        actor = await access.member(ctx);
      if (input.pageId) {
        const p = await pageRow(tx, input.pageId);
        if (
          p.hidden ||
          (!p.current_revision_id &&
            p.creator_id !== actor.userId &&
            !(await access.capabilities(ctx)).canGovernBody)
        )
          throw new ForbiddenException('KNOWLEDGE_UNAVAILABLE');
      }
      const old = await tx
        .selectFrom('knowledge_drafts')
        .selectAll()
        .where('owner_id', '=', actor.userId)
        .where('editing_task_id', '=', input.editingTaskId)
        .executeTakeFirst();
      if ((old?.version ?? 0) !== input.expectedVersion) conflict('DRAFT_CONFLICT');
      const id = old?.id ?? randomUUID(),
        version = (old?.version ?? 0) + 1,
        now = new Date();
      const row = {
        id,
        owner_id: actor.userId,
        editing_task_id: input.editingTaskId,
        page_id: input.pageId,
        payload: JSON.stringify(input.content),
        version,
        updated_at: now,
      };
      if (old) await tx.updateTable('knowledge_drafts').set(row).where('id', '=', id).execute();
      else await tx.insertInto('knowledge_drafts').values(row).execute();
      return { draftId: id, version, savedAt: now.toISOString() };
    });
  }
  async readOwn(ctx: RequestContext, editingTaskId: string) {
    const actor = await new KnowledgeAccess(this.db).member(ctx);
    const r = await this.db
      .selectFrom('knowledge_drafts')
      .selectAll()
      .where('owner_id', '=', actor.userId)
      .where('editing_task_id', '=', editingTaskId)
      .executeTakeFirst();
    if (!r) return null;
    return {
      ...KnowledgeDraftSchema.parse({
        editingTaskId: r.editing_task_id,
        pageId: r.page_id,
        expectedVersion: r.version,
        content: JSON.parse(r.payload) as unknown,
      }),
      draftId: r.id,
      version: r.version,
      savedAt: r.updated_at.toISOString(),
    };
  }
  async list(ctx: RequestContext) {
    const actor = await new KnowledgeAccess(this.db).member(ctx);
    const rows = await this.db
      .selectFrom('knowledge_drafts')
      .select([
        'id',
        'editing_task_id as editingTaskId',
        'page_id as pageId',
        'version',
        'updated_at as updatedAt',
        'payload',
      ])
      .where('owner_id', '=', actor.userId)
      .orderBy('updated_at', 'desc')
      .limit(100)
      .execute();
    return rows.map(({ payload, ...row }) => ({
      ...row,
      title: KnowledgeDraftSchema.shape.content.parse(JSON.parse(payload) as unknown).title,
    }));
  }
  async remove(ctx: RequestContext, editingTaskId: string) {
    return knowledgeWrite(this.db, async (tx) => {
      const actor = await new KnowledgeAccess(tx).member(ctx);
      await tx
        .deleteFrom('knowledge_drafts')
        .where('owner_id', '=', actor.userId)
        .where('editing_task_id', '=', editingTaskId)
        .execute();
    });
  }
}
