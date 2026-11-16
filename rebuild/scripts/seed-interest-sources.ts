import { connectDatabase } from '../apps/api/src/database/connection.js';
import { audit } from '../apps/api/src/modules/community-interest/common.js';
import { NewsService } from '../apps/api/src/modules/community-interest/news.service.js';

// Only factual release metadata is displayed; release bodies are never republished.
// Existing source settings are never overwritten by this initialization command.
const definitions = [
  ['github-transformers', 'Hugging Face Transformers', 'ai', 'huggingface/transformers'],
  ['github-vscode', 'Visual Studio Code', 'technology', 'microsoft/vscode'],
  ['github-rust', 'Rust', 'opensource', 'rust-lang/rust'],
  ['github-geth', 'Go Ethereum', 'web3', 'ethereum/go-ethereum'],
] as const;
const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('DATABASE_URL_REQUIRED');
const enabled = process.argv.includes('--enable-metadata');
const db = connectDatabase(raw);
try {
  for (const [id, name, board, repository] of definitions) {
    if (
      await db.selectFrom('interest_sources').select('id').where('id', '=', id).executeTakeFirst()
    )
      continue;
    await db.transaction().execute(async (tx) => {
      await tx
        .insertInto('interest_sources')
        .values({
          id,
          name,
          board,
          kind: 'github',
          url: `https://api.github.com/repos/${repository}/releases?per_page=10`,
          terms_url: 'https://docs.github.com/en/rest/releases/releases',
          enabled: Number(enabled),
          approved: Number(enabled),
          etag: null,
          last_error: '',
          fetched_at: null,
          due_at: new Date(),
        })
        .execute();
      await audit(
        tx,
        'system',
        'interest.source.initialize',
        id,
        enabled
          ? '仅公开发布标题、版本号、来源链接与时间；不转载 release 正文；操作员显式启用元数据采集'
          : '初始化待确认来源，未启用采集',
      );
    });
  }
  if (enabled) for (const [id] of definitions) await new NewsService(db).collect(id);
  console.log(
    'Release sources initialized. Metadata collection:',
    enabled ? 'enabled' : 'disabled; review and enable in administration',
  );
  const status = await db
    .selectFrom('interest_sources')
    .select(['name', 'enabled', 'last_error', 'fetched_at'])
    .where(
      'id',
      'in',
      definitions.map((d) => d[0]),
    )
    .execute();
  console.log(JSON.stringify(status));
} finally {
  await db.destroy();
}
