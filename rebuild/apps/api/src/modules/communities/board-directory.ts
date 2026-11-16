import { BadRequestException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../database/database.types.js';
import { boardModerators } from '../admin/board-moderators.js';
import {
  boardSlug,
  communitySlug,
  legacyBoardCommunities,
} from '../../../../../packages/contracts/src/boards.js';

export async function listBoards(db: Kysely<Database>) {
  const [moderators, rows, stored] = await Promise.all([
    boardModerators(db),
    db.selectFrom('communities').selectAll().orderBy('display_order').orderBy('id').execute(),
    db
      .selectFrom('runtime_settings')
      .select('value')
      .where('id', '=', 'site-settings')
      .executeTakeFirst(),
  ]);
  const settings = stored
    ? (JSON.parse(stored.value).boards as Record<
        string,
        { description?: string; rules?: string[] }
      >)
    : {};
  const defaults = Object.entries(legacyBoardCommunities)
    .filter(([, slug]) => !rows.some((row) => row.slug === slug))
    .map(([board, slug]) => ({
      id: 'default-' + slug,
      slug: board,
      name:
        (
          {
            daily: '校园日常',
            questions: '问答求助',
            market: '二手交易',
            treehole: '树洞',
            buddies: '搭子活动',
            resources: '资源共享',
          } as Record<string, string>
        )[board] || board,
      description: '',
      rules: [] as string[],
      state: 'open' as const,
      moderatorId: moderators.find((entry) => entry.board === board)?.userId || null,
    }));
  return [
    ...defaults,
    ...rows.map((row) => ({
      id: row.id,
      slug: boardSlug(row.slug),
      name: row.name,
      description: settings[boardSlug(row.slug)]?.description || row.description,
      rules: settings[boardSlug(row.slug)]?.rules || [],
      state: 'open' as const,
      moderatorId: moderators.find((entry) => entry.board === boardSlug(row.slug))?.userId || null,
    })),
  ];
}

export async function requireBoards(db: Kysely<Database>, boards: readonly string[]) {
  if (!boards.length) return;
  const slugs = [
    ...new Set(
      boards.filter((board) => !Object.hasOwn(legacyBoardCommunities, board)).map(communitySlug),
    ),
  ];
  if (!slugs.length) return;
  const found = await db
    .selectFrom('communities')
    .select('slug')
    .where('slug', 'in', slugs)
    .execute();
  if (found.length !== slugs.length) throw new BadRequestException('UNKNOWN_BOARD');
}
