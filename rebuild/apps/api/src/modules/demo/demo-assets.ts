import { createHash } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { Database } from '../../database/database.types.js';
import {putAsset} from './r2-assets.js';

export async function storeDemoAssets(
  tx: Transaction<Database>,
  value: unknown,
  field = '',
): Promise<unknown> {
  if (
    ['image', 'images', 'avatar'].includes(field) &&
    typeof value === 'string' &&
    value.startsWith('data:image/')
  ) {
    const id = createHash('sha256').update(value).digest('hex');
    const existing=await tx.selectFrom('demo_assets').select('id').where('id','=',id).executeTakeFirst();
    if(existing)return '/api/backend/demo/assets/'+id;
    if(process.env.ASSET_STORAGE==='r2'){
      // Serialize uploads across API processes and reserve headroom below 10 GB.
      await tx.insertInto('runtime_settings').values({id:'r2-upload-lock',revision:0,value:'{}',updated_at:new Date()}).onDuplicateKeyUpdate({id:'r2-upload-lock'}).execute();
      await tx.selectFrom('runtime_settings').select('id').where('id','=','r2-upload-lock').forUpdate().executeTakeFirstOrThrow();
      const count=await tx.selectFrom('demo_assets').select(tx.fn.countAll<number>().as('count')).where('data','like','r2:images/%').executeTakeFirstOrThrow();
      if(Number(count.count)>=1500)throw new Error('R2_STORAGE_LIMIT_REACHED');
    }
    const stored=await putAsset(id,value);
    await tx
      .insertInto('demo_assets')
      .values({ id, data: stored?'r2:images/'+id:value })
      .onDuplicateKeyUpdate({ id })
      .execute();
    return '/api/backend/demo/assets/' + id;
  }
  if (Array.isArray(value))
    return Promise.all(value.map((item) => storeDemoAssets(tx, item, field)));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, item]) => [
          key,
          await storeDemoAssets(tx, item, key),
        ]),
      ),
    );
  return value;
}
