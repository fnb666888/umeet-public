import { z } from 'zod';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { JobsService } from './jobs.service.js';
const EventSchema = z.strictObject({
  id: z.string().min(1).max(180),
  kind: z.string().regex(/^[a-z][a-z0-9.-]{0,69}$/),
  aggregateId: z.string().min(1).max(64),
  versionId: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()),
});
export type DomainEvent = z.infer<typeof EventSchema>;
// The transaction belongs to the business write; no independent commit or in-memory queue.
export class OutboxService {
  constructor(private readonly db: Kysely<Database>) {}
  async recordEvent(
    tx: Transaction<Database>,
    event: DomainEvent,
    now = new Date(),
  ): Promise<void> {
    const data = EventSchema.parse(event);
    await new JobsService(this.db).enqueue(
      tx,
      {
        kind: 'event:' + data.kind,
        key: 'event:' + data.id,
        payload: { ...data.payload, aggregateId: data.aggregateId, versionId: data.versionId },
      },
      now,
    );
  }
}
