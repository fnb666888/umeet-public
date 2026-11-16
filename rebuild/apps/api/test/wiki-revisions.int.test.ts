import { afterEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { IdentityService } from '../src/modules/identity/identity.service.js';
import { CommunitiesService } from '../src/modules/communities/communities.service.js';
import { WikiService } from '../src/modules/wiki/wiki.service.js';
import { WikiLinksService } from '../src/modules/wiki/wiki-links.service.js';
import { WikiDiffService } from '../src/modules/wiki/wiki-diff.service.js';
import type { RequestContext } from '../../../packages/contracts/src/index.js';
let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function fixture() {
  h = await createTestApp();
  await new CommunitiesService(h.db).seedDefaults();
  const actor = await new IdentityService(h.db).resolve({
    provider: 'test',
    subject: 'wiki-author',
    kind: 'member',
  });
  return {
    db: h.db,
    ctx: { actor, requestId: 'wiki' } satisfies RequestContext,
    wiki: new WikiService(h.db),
  };
}
describe('immutable community wiki revisions', () => {
  it('keeps identically named entries separate in each community', async () => {
    const { wiki, ctx } = await fixture();
    const a = await wiki.createPage(ctx, 'default-resources', 'entropy');
    const b = await wiki.createPage(ctx, 'default-campus', 'entropy');
    await wiki.saveRevision(ctx, a.id, {
      title: '熵',
      markdown: '资源词条',
      baseRevisionId: null,
      changeNote: '创建',
      idempotencyKey: 'first-save',
    });
    await wiki.saveRevision(ctx, b.id, {
      title: '熵',
      markdown: '校园词条',
      baseRevisionId: null,
      changeNote: '创建',
      idempotencyKey: 'first-save',
    });
    expect((await wiki.read(a.id))?.markdown).toBe('资源词条');
    expect((await wiki.read(b.id))?.markdown).toBe('校园词条');
    const endpoint = '/api/v1/communities/wiki/search';
    const client = request(h!.app.getHttpServer());
    expect((await client.get(endpoint).query({ q: '校园词条' }).expect(200)).body).toEqual([
      { pageId: b.id, communitySlug: 'campus', title: '熵' },
    ]);
    await h!.db
      .updateTable('wiki_revisions')
      .set({ visibility: 'hidden' })
      .where('page_id', '=', b.id)
      .execute();
    expect((await client.get(endpoint).query({ q: '校园词条' }).expect(200)).body).toEqual([]);
  });
  it('rejects conflicting saves instead of overwriting, even with concurrent requests', async () => {
    const { wiki, ctx } = await fixture();
    const page = await wiki.createPage(ctx, 'default-resources', 'python');
    const first = await wiki.saveRevision(ctx, page.id, {
      title: 'Python',
      markdown: '初稿',
      baseRevisionId: null,
      changeNote: '创建',
      idempotencyKey: 'initial-key',
    });
    const results = await Promise.allSettled(
      ['甲修改', '乙修改'].map((markdown, i) =>
        wiki.saveRevision(ctx, page.id, {
          title: 'Python',
          markdown,
          baseRevisionId: first.id,
          changeNote: '修正',
          idempotencyKey: 'edit-key-' + i,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected');
    if (failure?.status !== 'rejected') throw new Error('expected conflict');
    expect(failure.reason.getStatus()).toBe(409);
    expect(await wiki.history(page.id)).toHaveLength(2);
  });
  it('deduplicates retried saves and refuses key reuse with different content', async () => {
    const { wiki, ctx } = await fixture();
    const page = await wiki.createPage(ctx, 'default-resources', 'retry');
    const input = {
      title: '重试',
      markdown: '同一正文',
      baseRevisionId: null,
      changeNote: '创建',
      idempotencyKey: 'retry-key',
    };
    const one = await wiki.saveRevision(ctx, page.id, input);
    const two = await wiki.saveRevision(ctx, page.id, input);
    expect(two.id).toBe(one.id);
    await expect(
      wiki.saveRevision(ctx, page.id, { ...input, markdown: '不同正文' }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    expect(await wiki.history(page.id)).toHaveLength(1);
  });
  it('rolls back as a new version and retains previous versions and events', async () => {
    const { wiki, ctx, db } = await fixture();
    const page = await wiki.createPage(ctx, 'default-resources', 'history');
    const one = await wiki.saveRevision(ctx, page.id, {
      title: '历史',
      markdown: '第一版',
      baseRevisionId: null,
      changeNote: '创建',
      idempotencyKey: 'create-key',
    });
    const two = await wiki.saveRevision(ctx, page.id, {
      title: '历史',
      markdown: '第二版',
      baseRevisionId: one.id,
      changeNote: '修改',
      idempotencyKey: 'update-key',
    });
    const rollback = await wiki.rollback(ctx, page.id, {
      targetRevisionId: one.id,
      baseRevisionId: two.id,
      idempotencyKey: 'rollback-key',
    });
    expect(rollback.id).not.toBe(one.id);
    expect(rollback.previousRevisionId).toBe(two.id);
    expect(rollback.markdown).toBe('第一版');
    expect(await wiki.history(page.id)).toHaveLength(3);
    expect(
      await db.selectFrom('jobs').selectAll().where('kind', '=', 'wiki.updated').execute(),
    ).toHaveLength(3);
  });
  it('does not expose or allow editing a draft without a registered identity', async () => {
    const { wiki, ctx, db } = await fixture();
    const guest = await new IdentityService(db).resolve({
      provider: 'test',
      subject: 'guest-wiki',
      kind: 'guest',
    });
    await expect(
      wiki.createPage({ actor: guest, requestId: 'g' }, 'default-resources', 'blocked'),
    ).rejects.toThrow('REGISTERED_ACCOUNT_REQUIRED');
    const draft = await wiki.createPage(ctx, 'default-resources', 'empty');
    expect(await wiki.read(draft.id)).toBeNull();
  });
  it('rejects duplicate slugs with a domain conflict and refuses unsafe Markdown before publication', async () => {
    const { wiki, ctx } = await fixture();
    const page = await wiki.createPage(ctx, 'default-resources', 'unique');
    await expect(wiki.createPage(ctx, 'default-resources', 'unique')).rejects.toThrow(
      'WIKI_SLUG_UNAVAILABLE',
    );
    await expect(
      wiki.saveRevision(ctx, page.id, {
        title: '恶意',
        markdown: '[恶意](javascript:alert%281%29)',
        baseRevisionId: null,
        changeNote: '',
        idempotencyKey: 'unsafe-key',
      }),
    ).rejects.toThrow('UNSAFE_MARKDOWN');
    expect(await wiki.read(page.id)).toBeNull();
  });
  it('allows nonmembers to edit normally but respects protection and stale rollback versions', async () => {
    const { wiki, ctx, db } = await fixture();
    const page = await wiki.createPage(ctx, 'default-resources', 'protected');
    const one = await wiki.saveRevision(ctx, page.id, {
      title: '词条',
      markdown: '第一版',
      baseRevisionId: null,
      changeNote: '',
      idempotencyKey: 'normal-save',
    });
    await db.updateTable('wiki_pages').set({ protected: 1 }).where('id', '=', page.id).execute();
    await expect(
      wiki.saveRevision(ctx, page.id, {
        title: '词条',
        markdown: '无权限',
        baseRevisionId: one.id,
        changeNote: '',
        idempotencyKey: 'blocked-save',
      }),
    ).rejects.toThrow('WIKI_PROTECTED');
    await db
      .updateTable('moderation_groups')
      .set({ boards: JSON.stringify(['resources']) })
      .where('name', '=', '版主')
      .execute();
    const group = await db
      .selectFrom('moderation_groups')
      .select('id')
      .where('name', '=', '版主')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('moderation_group_members')
      .values({
        user_id: ctx.actor.userId,
        group_id: group.id,
        boards: JSON.stringify(['resources']),
      })
      .execute();
    const two = await wiki.saveRevision(ctx, page.id, {
      title: '词条',
      markdown: '版主更新',
      baseRevisionId: one.id,
      changeNote: '',
      idempotencyKey: 'moderator-save',
    });
    await expect(
      wiki.rollback(ctx, page.id, {
        targetRevisionId: one.id,
        baseRevisionId: one.id,
        idempotencyKey: 'stale-rollback',
      }),
    ).rejects.toThrow('词条已有更新');
    expect((await wiki.read(page.id))?.id).toBe(two.id);
  });
  it('updates scoped backlinks atomically on save and rollback while retaining historical references', async () => {
    const { wiki, ctx, db } = await fixture();
    const links = new WikiLinksService(db);
    const target = await wiki.createPage(ctx, 'default-campus', 'library');
    await wiki.saveRevision(ctx, target.id, {
      title: '图书馆',
      markdown: '地点说明',
      baseRevisionId: null,
      changeNote: '',
      idempotencyKey: 'target-create',
    });
    const source = await wiki.createPage(ctx, 'default-resources', 'study');
    const one = await wiki.saveRevision(ctx, source.id, {
      title: '自习',
      markdown: '去 [[campus/library|图书馆]]\n\n`[[campus/library]]`',
      baseRevisionId: null,
      changeNote: '',
      idempotencyKey: 'source-create',
    });
    expect(await links.listBacklinks(target.id)).toEqual([
      { pageId: source.id, title: '自习', communitySlug: 'resources' },
    ]);
    const two = await wiki.saveRevision(ctx, source.id, {
      title: '自习',
      markdown: '暂时没有链接',
      baseRevisionId: one.id,
      changeNote: '',
      idempotencyKey: 'source-update',
    });
    expect(await links.listBacklinks(target.id)).toEqual([]);
    await wiki.rollback(ctx, source.id, {
      targetRevisionId: one.id,
      baseRevisionId: two.id,
      idempotencyKey: 'restore-links',
    });
    expect(await links.listBacklinks(target.id)).toHaveLength(1);
  });
  it('returns textual and attachment changes, but never compares a hidden revision', async () => {
    const { wiki, ctx, db } = await fixture();
    const page = await wiki.createPage(ctx, 'default-resources', 'diff');
    const one = await wiki.saveRevision(ctx, page.id, {
      title: '差异',
      markdown: '共同段落\n\n旧内容\n\n![旧图](/media/old)',
      baseRevisionId: null,
      changeNote: '',
      idempotencyKey: 'diff-first',
    });
    const two = await wiki.saveRevision(ctx, page.id, {
      title: '差异',
      markdown: '共同段落\n\n新内容\n\n![新图](/media/new)',
      baseRevisionId: one.id,
      changeNote: '',
      idempotencyKey: 'diff-second',
    });
    const diff = new WikiDiffService(db);
    const result = await diff.getRevisionDiff(one.id, two.id);
    expect(result.blocks.some((b) => b.kind === 'removed' && b.text.includes('旧内容'))).toBe(true);
    expect(result.attachments).toEqual({ added: ['/media/new'], removed: ['/media/old'] });
    await db
      .updateTable('wiki_revisions')
      .set({ visibility: 'hidden' })
      .where('id', '=', one.id)
      .execute();
    await expect(diff.getRevisionDiff(one.id, two.id)).rejects.toThrow('WIKI_REVISION_NOT_FOUND');
  });
  it('atomically publishes a new page and returns the committed version after a lost-response retry', async () => {
    const { wiki, ctx, db } = await fixture();
    const input = {
      title: '首次发布',
      markdown: '原子创建正文',
      baseRevisionId: null,
      changeNote: '创建',
      idempotencyKey: 'new-publication',
    };
    const one = await wiki.publishNew(ctx, 'default-resources', 'atomic-new', input);
    const retry = await wiki.publishNew(ctx, 'default-resources', 'atomic-new', input);
    expect(retry.id).toBe(one.id);
    const parallel = await Promise.all(
      [0, 1, 2].map(() =>
        wiki.publishNew(ctx, 'default-resources', 'parallel-new', {
          ...input,
          idempotencyKey: 'parallel-publication',
        }),
      ),
    );
    expect(new Set(parallel.map((revision) => revision.id)).size).toBe(1);
    await expect(
      wiki.publishNew(ctx, 'default-resources', 'atomic-new', { ...input, markdown: '不同内容' }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await expect(
      wiki.publishNew(ctx, 'default-resources', 'unsafe-atomic', {
        ...input,
        markdown: '<script>bad()</script>',
      }),
    ).rejects.toThrow('UNSAFE_MARKDOWN');
    expect(
      await db.selectFrom('wiki_pages').select('id').where('slug', '=', 'unsafe-atomic').execute(),
    ).toEqual([]);
    expect(await wiki.history(one.pageId)).toHaveLength(1);
  });
});
