import { randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
export type AuditEvent = { actorId: string | null; kind: string; targetId: string; reason: string };
export class AuditService {
  async append(tx: Transaction<Database>, event: AuditEvent): Promise<void> {
    await tx
      .insertInto('audit_events')
      .values({
        id: randomUUID(),
        actor_id: event.actorId,
        kind: event.kind,
        target_id: event.targetId,
        reason: event.reason,
        created_at: new Date(),
      })
      .execute();
  }
}
