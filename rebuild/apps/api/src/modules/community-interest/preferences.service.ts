import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../../../../packages/contracts/src/index.js';
import {
  InterestPreferencesInput,
  type InterestPreferences,
} from '../../../../../packages/contracts/src/interest.js';
import { requireBoards } from '../communities/board-directory.js';
import { DemoSnapshotsService } from '../demo/demo-snapshots.service.js';
import { businessDay, parse, writeActor, type InterestDb } from './common.js';

export class PreferencesService {
  constructor(readonly db: InterestDb) {}
  async get(userId: string | null): Promise<InterestPreferences & { onboardingNeeded: boolean }> {
    const row = userId
      ? await this.db
          .selectFrom('interest_preferences')
          .select('data')
          .where('user_id', '=', userId)
          .executeTakeFirst()
      : undefined;
    return row
      ? { ...(JSON.parse(row.data) as InterestPreferences), onboardingNeeded: false }
      : { onboarding: 'skipped', boards: [], tags: [], dismissed: [], onboardingNeeded: !!userId };
  }
  async save(ctx: RequestContext, input: unknown) {
    const actor = await writeActor(this.db, ctx);
    const data = parse(InterestPreferencesInput, input);
    await requireBoards(this.db, data.boards);
    await this.db.transaction().execute(async (tx) => {
      const old = await tx
        .selectFrom('interest_preferences')
        .select('data')
        .where('user_id', '=', actor.userId)
        .forUpdate()
        .executeTakeFirst();
      const saved = {
        ...data,
        boards: [...new Set(data.boards)],
        tags: [...new Set(data.tags)],
        dismissed: old ? (JSON.parse(old.data) as InterestPreferences).dismissed : [],
      };
      await tx
        .insertInto('interest_preferences')
        .values({ user_id: actor.userId, data: JSON.stringify(saved), updated_at: new Date() })
        .onDuplicateKeyUpdate({ data: JSON.stringify(saved), updated_at: new Date() })
        .execute();
      if (data.onboarding === 'completed' && data.boards.length) {
        // Preserve all existing subscriptions; onboarding only adds explicitly chosen boards.
        await tx
          .insertInto('demo_user_states')
          .values({ user_id: actor.userId, data: '{}', updated_at: new Date() })
          .onDuplicateKeyUpdate({ user_id: actor.userId })
          .execute();
        const stateRow = await tx
          .selectFrom('demo_user_states')
          .select('data')
          .where('user_id', '=', actor.userId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const state = JSON.parse(stateRow.data) as Record<string, unknown>;
        const existing = Array.isArray(state['followedBoards'])
          ? (state['followedBoards'] as string[])
          : ['daily', 'questions', 'market', 'treehole', 'buddies', 'resources'];
        state['followedBoards'] = [...new Set([...existing, ...data.boards])];
        await tx
          .updateTable('demo_user_states')
          .set({ data: JSON.stringify(state), updated_at: new Date() })
          .where('user_id', '=', actor.userId)
          .execute();
      }
    });
    return this.get(actor.userId);
  }
  async dismiss(ctx: RequestContext, id: string) {
    const actor = await writeActor(this.db, ctx);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new BadRequestException('INVALID_ID');
    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('interest_preferences')
        .values({
          user_id: actor.userId,
          data: JSON.stringify({ onboarding: 'skipped', boards: [], tags: [], dismissed: [] }),
          updated_at: new Date(),
        })
        .onDuplicateKeyUpdate({ user_id: actor.userId })
        .execute();
      const row = await tx
        .selectFrom('interest_preferences')
        .select('data')
        .where('user_id', '=', actor.userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const value = JSON.parse(row.data) as InterestPreferences;
      value.dismissed = [...new Set([...value.dismissed, id])].slice(-500);
      await tx
        .updateTable('interest_preferences')
        .set({ data: JSON.stringify(value), updated_at: new Date() })
        .where('user_id', '=', actor.userId)
        .execute();
    });
    return { ok: true };
  }
  async recommendations(ctx: RequestContext) {
    const userId = ctx.actor?.userId || null;
    const snapshot = await new DemoSnapshotsService(this.db).get(userId, false);
    const prefs = await this.get(userId);
    const followed = new Set(snapshot.userState.followedBoards || []);
    const tags = new Set([...prefs.tags, ...(snapshot.userState.tagFollows || [])]);
    const dismissed = new Set(prefs.dismissed);
    const now = Date.now();
    const ranked = snapshot.content.posts
      .filter((p) => !dismissed.has(p.id))
      .map((p) => {
        const reasons: string[] = [];
        let score = 0;
        if (followed.has(p.community)) {
          score += 4;
          reasons.push('已订阅的板块');
        }
        if (p.tags?.some((t) => tags.has(t))) {
          score += 3;
          reasons.push('你选择的兴趣标签');
        }
        const replies = snapshot.content.comments[p.id]?.length || 0;
        score += Math.min(p.likes, 10) * 0.15 + Math.min(replies, 10) * 0.1;
        const age = Math.max(0, (now - p.createdAt) / 3600000);
        score += 2 / (1 + age / 24);
        if (!reasons.length) reasons.push(replies ? '近期有讨论的内容' : '近期内容');
        return { id: p.id, reasons, score };
      })
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return {
      ruleVersion: 'explicit-interests-v1',
      businessDay: businessDay(),
      items: ranked.slice(0, 50).map(({ id, reasons }) => ({ id, reasons })),
    };
  }
}
