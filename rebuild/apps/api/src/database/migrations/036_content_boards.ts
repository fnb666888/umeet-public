import type { Kysely } from 'kysely';
import type { Database } from '../database.types.js';
import { contentBoards } from '../../../../../packages/contracts/src/interest.js';

export async function up(db: Kysely<Database>) {
  for (const [offset, board] of contentBoards.entries()) {
    const existing = await db
      .selectFrom('communities')
      .select('id')
      .where('slug', '=', board.slug)
      .executeTakeFirst();
    if (existing) continue;
    const id = 'interest-' + board.slug;
    await db
      .insertInto('communities')
      .values({ id, ...board, is_default: 0, display_order: 90 + offset })
      .execute();
    await db
      .insertInto('wiki_spaces')
      .values({ id: 'wiki-' + id, community_id: id })
      .execute();
  }
}
