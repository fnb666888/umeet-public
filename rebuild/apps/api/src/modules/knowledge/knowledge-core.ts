import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
export type KnowledgeDb = Kysely<Database>;
export async function knowledgeWrite<T>(
  db: KnowledgeDb,
  work: (tx: KnowledgeDb) => Promise<T>,
): Promise<T> {
  // Serialize shared graph mutations as well as each publication. The initial graph is
  // small; this avoids cross-page prerequisite cycles and freeze/publication races.
  return db
    .transaction()
    .setIsolationLevel('read committed')
    .execute(async (tx) => {
      await tx
        .selectFrom('knowledge_locks')
        .select('id')
        .where('id', '=', 'write')
        .forUpdate()
        .executeTakeFirstOrThrow();
      return work(tx);
    });
}
export function conflict(code: string, latestRevisionId?: string | null): never {
  throw new ConflictException({ code, message: code, latestRevisionId });
}
export function validReason(reason: string) {
  if (!reason.trim() || reason.length > 4000) throw new BadRequestException('REASON_REQUIRED');
  return reason.trim();
}
export function aliasName(name: string) {
  return name.normalize('NFKC').trim().toLowerCase();
}
export async function pageRow(db: KnowledgeDb, pageId: string) {
  const p = await db
    .selectFrom('knowledge_pages')
    .selectAll()
    .where('id', '=', pageId)
    .executeTakeFirst();
  if (!p || p.purged) throw new NotFoundException('KNOWLEDGE_UNAVAILABLE');
  return p;
}
export async function event(
  db: KnowledgeDb,
  ctx: RequestContext,
  pageId: string | null,
  action: string,
  reason: string,
) {
  await db
    .insertInto('knowledge_events')
    .values({
      id: randomUUID(),
      page_id: pageId,
      actor_id: ctx.actor!.userId,
      action,
      reason,
      created_at: new Date(),
    })
    .execute();
}
