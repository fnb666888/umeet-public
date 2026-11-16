import { expect, it } from 'vitest';
import { DemoSnapshotsService } from '../src/modules/demo/demo-snapshots.service';
import type { Kysely } from 'kysely';
import type { Database } from '../src/database/database.types';

it('overlaps independent snapshot reads without mixing private account state', async () => {
  let active = 0,
    peak = 0;
  const db = {
    selectFrom(table: string) {
      const read = async (first = false) => {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        const rows =
          table === 'demo_user_states'
            ? [{ user_id: 'alice', data: JSON.stringify({ bookmarks: ['alice-only'] }) }]
            : table === 'demo_content'
              ? [{ version: 7 }]
              : [];
        return first ? rows[0] : rows;
      };
      const query: any = new Proxy(
        {},
        {
          get: (_, key) =>
            key === 'execute'
              ? () => read()
              : key === 'executeTakeFirst'
                ? () => read(true)
                : () => query,
        },
      );
      return query;
    },
  } as unknown as Kysely<Database>;
  const result = await new DemoSnapshotsService(db).get('alice', false);
  expect(result.version).toBe(7);
  expect(result.userState.bookmarks).toEqual(['alice-only']);
  expect(result.userState.threads).toEqual([]);
  expect(peak).toBeGreaterThan(1);
});
