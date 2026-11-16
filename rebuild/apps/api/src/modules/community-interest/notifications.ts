import { createHash } from 'node:crypto';
import type { InterestTx } from './common.js';

export async function notifyFollowers(
  tx: InterestTx,
  kind: 'news' | 'forecast',
  targetId: string,
  event: string,
  text: string,
  exceptUser = '',
) {
  const followers = await tx
    .selectFrom('interest_actions')
    .select('user_id')
    .where('target_type', '=', kind)
    .where('target_id', '=', targetId)
    .where('kind', '=', 'follow')
    .where('user_id', '!=', exceptUser)
    .execute();
  for (const follower of followers) {
    const id = createHash('sha256')
      .update(event + ':' + follower.user_id)
      .digest('hex')
      .slice(0, 32);
    await tx
      .insertInto('admin_notifications')
      .values({
        id,
        user_id: follower.user_id,
        text,
        detail: '打开详情查看当前可见内容。',
        href: '/#/' + (kind === 'news' ? 'news' : 'forecasts') + '/' + targetId,
        created_at: new Date(),
      })
      .onDuplicateKeyUpdate({ id })
      .execute();
  }
}
