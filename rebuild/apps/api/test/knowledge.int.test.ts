import { afterEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './support/test-app.js';
import { IdentityService } from '../src/modules/identity/identity.service.js';
import { CommunitiesService } from '../src/modules/communities/communities.service.js';
import { KnowledgeService } from '../src/modules/knowledge/knowledge.service.js';
import { KnowledgeLinksService } from '../src/modules/knowledge/knowledge-links.service.js';
import { KnowledgeDiffService } from '../src/modules/knowledge/knowledge-diff.service.js';
import { PasswordAuthService } from '../src/modules/identity/password-auth.service.js';
import type {
  KnowledgeRevisionInput,
  RequestContext,
} from '../../../packages/contracts/src/index.js';
let h: TestApp | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
function content(title = '测试词条', baseRevisionId: string | null = null): KnowledgeRevisionInput {
  return {
    title,
    summary: '知识摘要',
    markdown: '# 正文\n\n公开内容',
    template: 'plain',
    relations: [],
    baseRevisionId,
    changeNote: '修改说明',
    idempotencyKey: crypto.randomUUID(),
  };
}
async function fixture() {
  h = await createTestApp();
  await new CommunitiesService(h.db).seedDefaults();
  const identity = new IdentityService(h.db);
  async function actor(subject: string): Promise<RequestContext> {
    return {
      actor: await identity.resolve({ provider: 'test', subject, kind: 'member' }),
      requestId: subject,
    };
  }
  const admin = await actor('knowledge-admin'),
    member = await actor('knowledge-member'),
    other = await actor('knowledge-other'),
    manager = await actor('knowledge-manager');
  await h.db
    .insertInto('platform_roles')
    .values({ user_id: admin.actor!.userId, role: 'admin' })
    .execute();
  await h.db
    .insertInto('moderation_groups')
    .values({
      id: 'knowledge-test',
      name: '知识维护',
      boards: JSON.stringify(['resources']),
      permissions: JSON.stringify(['wiki.view', 'wiki.edit']),
    })
    .execute();
  await h.db
    .insertInto('moderation_group_members')
    .values({ group_id: 'knowledge-test', user_id: manager.actor!.userId })
    .execute();
  const wiki = new KnowledgeService(h.db);
  async function publish(input = content()) {
    const p = await wiki.create(admin);
    return wiki.publish(admin, p.id, input);
  }
  return { db: h.db, wiki, admin, member, other, manager, publish };
}
describe('shared knowledge lifecycle', () => {
  it('paginates authorized review queues and filters on the server', async () => {
    const f = await fixture();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = await f.wiki.create(f.member);
      ids.push((await f.wiki.submit(f.member, p.id, content('候选 ' + i))).id);
    }
    const first = await f.wiki.proposals(f.manager, { state: 'pending', limit: 2 });
    expect(first).toHaveLength(2);
    const second = await f.wiki.proposals(f.manager, {
      state: 'pending',
      limit: 2,
      cursor: first[1]!.id,
    });
    expect(second).toHaveLength(2);
    expect(new Set([...first, ...second].map((p) => p.id)).size).toBe(4);
    expect(await f.wiki.proposals(f.other, { state: 'pending', limit: 2 })).toEqual([]);
    await expect(f.wiki.publisher.proposal(f.other, ids[0]!)).rejects.toThrow('PROPOSAL_NOT_FOUND');
    expect((await f.wiki.publisher.proposal(f.member, ids[0]!)).authorId).toBe(
      f.member.actor!.userId,
    );
  });
  it('returns explicit empty drafts, anonymous capabilities and rejects a stale account binding', async () => {
    const f = await fixture();
    const client = request(h!.app.getHttpServer());
    const guest = await client.get('/api/v1/knowledge/capabilities').expect(200);
    expect(guest.body).toMatchObject({ accountId: null, canContribute: false });
    const auth = await new PasswordAuthService(f.db).register(
      { username: 'knowledge_http', password: 'Knowledge http test 84!' },
      'knowledge-http',
    );
    expect(
      (
        await client
          .get('/api/v1/knowledge/drafts/empty')
          .auth(auth.token, { type: 'bearer' })
          .expect(200)
      ).body,
    ).toEqual({ draft: null });
    await client
      .post('/api/v1/knowledge/pages')
      .auth(auth.token, { type: 'bearer' })
      .set('X-Knowledge-Account', 'someone-else')
      .send({})
      .expect(403);
  });
  it('indexes only published body references and returns exact retry snapshots and safe diffs', async () => {
    const f = await fixture();
    const target = await f.publish(content('引用目标'));
    const source = await f.publish(content('引用来源'));
    const original = {
      ...content('引用来源', source.revisionId),
      markdown: '[引用目标](/knowledge/' + target.id + ')',
    };
    const linked = await f.wiki.publish(f.admin, source.id, original);
    const links = new KnowledgeLinksService(f.db);
    expect(await links.backlinks(target.id)).toEqual([{ pageId: source.id, title: '引用来源' }]);
    const newer = await f.wiki.publish(f.admin, source.id, {
      ...content('重命名来源', linked.revisionId),
      markdown: 'no link',
    });
    const retry = await f.wiki.publish(f.admin, source.id, original);
    expect(retry.revisionId).toBe(linked.revisionId);
    expect(retry.markdown).toBe(original.markdown);
    expect((await f.wiki.read(source.id))?.revisionId).toBe(newer.revisionId);
    expect(await links.backlinks(target.id)).toEqual([]);
    const diff = await new KnowledgeDiffService(f.db).diff(
      source.id,
      linked.revisionId,
      newer.revisionId,
    );
    expect(diff.blocks.some((b) => b.kind === 'added' && b.text.includes('no link'))).toBe(true);
    await f.wiki.setVisibility(f.manager, source.id, true, '暂时隐藏');
    await expect(
      new KnowledgeDiffService(f.db).diff(source.id, linked.revisionId, newer.revisionId),
    ).rejects.toThrow('REVISION_NOT_FOUND');
  });
  it('keeps freeze and graph changes atomic under competing requests', async () => {
    const f = await fixture();
    const a = await f.publish(content('理论甲')),
      b = await f.publish(content('理论乙'));
    const attempts = await Promise.allSettled([
      f.wiki.publish(f.admin, a.id, {
        ...content('理论甲', a.revisionId),
        relations: [{ type: 'prerequisite', targetPageId: b.id }],
      }),
      f.wiki.publish(f.admin, b.id, {
        ...content('理论乙', b.revisionId),
        relations: [{ type: 'prerequisite', targetPageId: a.id }],
      }),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = (await f.wiki.read(a.id))!;
    const dispute = await f.wiki.raiseDispute(f.manager, a.id, '核对理论来源');
    await f.wiki.decideDispute(f.admin, dispute.disputeId, { action: 'pause', reason: '组织复核' });
    const proposed = await f.wiki.submit(f.member, a.id, content('复核修改', current.revisionId));
    await expect(
      f.wiki.review(f.manager, proposed.id, {
        decision: 'approve',
        reason: '尝试绕过',
        expectedPublishedRevisionId: current.revisionId,
        idempotencyKey: 'paused-review',
      }),
    ).rejects.toThrow('PUBLICATION_PAUSED');
    await f.wiki.review(f.admin, proposed.id, {
      decision: 'approve',
      reason: '根据资料逐项复核',
      expectedPublishedRevisionId: current.revisionId,
      idempotencyKey: 'admin-reviewed',
    });
    expect((await f.wiki.read(a.id))?.title).toBe('复核修改');
    expect((await f.wiki.read(a.id))?.authorId).toBe(f.member.actor!.userId);
  });
  it('creates separate tables and never exposes unpublished content through public endpoints', async () => {
    const f = await fixture();
    const p = await f.wiki.create(f.member);
    await f.wiki.submit(f.member, p.id, {
      ...content('private-needle'),
      markdown: 'secret-marker',
    });
    expect(await f.wiki.read(p.id)).toBeNull();
    expect((await f.wiki.search({ q: 'private-needle', limit: 20 })).items).toEqual([]);
    await request(h!.app.getHttpServer())
      .get('/api/v1/knowledge/pages/' + p.id)
      .expect(404);
    expect(await f.wiki.history(p.id)).toEqual([]);
    expect(await f.wiki.proposals(f.other)).toEqual([]);
    expect(await f.wiki.proposals(f.member)).toHaveLength(1);
    expect(await f.wiki.proposals(f.manager)).toHaveLength(1);
  });
  it('reviews global bodies from an unrelated community, returns with reasons and resubmits', async () => {
    const f = await fixture();
    const p = await f.wiki.create(f.member),
      input = content('待审词条');
    const proposed = await f.wiki.submit(f.member, p.id, input);
    await expect(
      f.wiki.review(f.other, proposed.id, {
        decision: 'approve',
        reason: '',
        expectedPublishedRevisionId: null,
        idempotencyKey: 'bad-review-key',
      }),
    ).rejects.toThrow();
    await f.wiki.review(f.manager, proposed.id, {
      decision: 'return',
      reason: '请补充来源',
      expectedPublishedRevisionId: null,
      idempotencyKey: 'return-001',
    });
    expect((await f.wiki.proposals(f.member))[0]?.reason).toBe('请补充来源');
    const again = await f.wiki.submit(f.member, p.id, { ...input, idempotencyKey: 'resubmit-001' });
    await f.wiki.review(f.manager, again.id, {
      decision: 'approve',
      reason: '已核对',
      expectedPublishedRevisionId: null,
      idempotencyKey: 'approve-001',
    });
    expect((await f.wiki.read(p.id))?.title).toBe('待审词条');
    await f.db
      .deleteFrom('moderation_group_members')
      .where('user_id', '=', f.manager.actor!.userId)
      .execute();
    await expect(
      f.wiki.publish(f.manager, p.id, content('撤权修改', (await f.wiki.read(p.id))!.revisionId)),
    ).rejects.toThrow();
  });
  it('serializes stale publication, duplicate review and retry without overwriting', async () => {
    const f = await fixture();
    const p = await f.publish();
    const next = content('更新', p.revisionId);
    const outcomes = await Promise.allSettled([
      f.wiki.publish(f.admin, p.id, next),
      f.wiki.publish(f.admin, p.id, { ...next, title: '另一更新', idempotencyKey: 'another-edit' }),
    ]);
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await f.wiki.history(p.id)).toHaveLength(2);
    const current = (await f.wiki.read(p.id))!;
    const retry = content('幂等修改', current.revisionId);
    const one = await f.wiki.publish(f.admin, p.id, retry);
    expect((await f.wiki.publish(f.admin, p.id, retry)).revisionId).toBe(one.revisionId);
    await expect(f.wiki.publish(f.admin, p.id, { ...retry, markdown: 'changed' })).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT',
    );
    const proposal = await f.wiki.submit(f.member, p.id, content('批准一次', one.revisionId));
    const reviews = await Promise.allSettled(
      ['one', 'two'].map((key) =>
        f.wiki.review(f.manager, proposal.id, {
          decision: 'approve',
          reason: '',
          expectedPublishedRevisionId: one.revisionId,
          idempotencyKey: 'review-' + key,
        }),
      ),
    );
    expect(reviews.filter((x) => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect(await f.wiki.history(p.id)).toHaveLength(4);
  });
  it('recovers complete owner-only drafts and rejects competing device saves', async () => {
    const f = await fixture();
    const { idempotencyKey, ...body } = content();
    const input = {
      editingTaskId: 'new-article',
      pageId: null,
      expectedVersion: 0,
      content: { ...body, title: '草稿标题', markdown: 'private-body', relations: [] },
    };
    const saved = await f.wiki.saveDraft(f.member, input);
    expect((await f.wiki.draft(f.member, 'new-article'))?.content).toEqual(input.content);
    expect(await f.wiki.draft(f.admin, 'new-article')).toBeNull();
    const results = await Promise.allSettled(
      ['a', 'b'].map((markdown) =>
        f.wiki.saveDraft(f.member, {
          ...input,
          expectedVersion: saved.version,
          content: { ...input.content, markdown },
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await f.wiki.draft(f.member, 'new-article'))?.version).toBe(2);
  });
  it('versions relation conditions, rejects prerequisite cycles and retains aliases', async () => {
    const f = await fixture();
    const a = await f.publish(content('A（理论）')),
      b = await f.publish(content('B（理论）'));
    const updated = await f.wiki.publish(f.admin, a.id, {
      ...content('A（新名）', a.revisionId),
      relations: [{ type: 'prerequisite', targetPageId: b.id, conditions: '先了解 B' }],
    });
    expect((await f.wiki.resolveTitle('A（理论）')).pageIds).toContain(a.id);
    await expect(
      f.wiki.publish(f.admin, b.id, {
        ...content('B（理论）', b.revisionId),
        relations: [{ type: 'prerequisite', targetPageId: a.id }],
      }),
    ).rejects.toThrow('PREREQUISITE_CYCLE');
    await f.wiki.submit(f.member, a.id, {
      ...content('A（新名）', updated.revisionId),
      relations: [{ type: 'prerequisite', targetPageId: b.id, conditions: '待审条件' }],
    });
    expect((await f.wiki.read(a.id))?.relations[0]?.conditions).toBe('先了解 B');
    expect((await f.wiki.relations(b.id)).incoming[0]?.sourcePageId).toBe(a.id);
  });
  it('shares one body in independent directories, checks organization versions and suggestions', async () => {
    const f = await fixture();
    const p = await f.publish();
    await expect(
      f.wiki.saveRoute(f.admin, 'missing-community', {
        expectedVersion: 0,
        title: '无效归属',
        goal: '不能产生孤立路线',
        steps: [{ id: 'missing', pageId: p.id, goal: '', intro: '', position: 0 }],
      }),
    ).rejects.toThrow('COMMUNITY_WIKI_MANAGEMENT_REQUIRED');
    const org = {
      expectedVersion: 0,
      nodes: [
        { id: 'physics-basic', parentId: null, title: '基础理论', position: 0 },
        { id: 'physics-apply', parentId: null, title: '实际应用', position: 1 },
      ],
      entries: [
        { nodeId: 'physics-basic', pageId: p.id, position: 0 },
        { nodeId: 'physics-apply', pageId: p.id, position: 0 },
      ],
      collections: [p.id],
    };
    await f.wiki.saveDirectory(f.manager, 'default-resources', org);
    await expect(f.wiki.saveDirectory(f.manager, 'default-campus', org)).rejects.toThrow();
    await f.wiki.saveDirectory(f.admin, 'default-campus', {
      ...org,
      nodes: [{ id: 'campus', parentId: null, title: '办事指南', position: 0 }],
      entries: [{ nodeId: 'campus', pageId: p.id, position: 0 }],
    });
    expect((await f.wiki.community('resources')).entries).toHaveLength(2);
    await expect(f.wiki.saveDirectory(f.admin, 'default-resources', org)).rejects.toThrow(
      'ORGANIZATION_CONFLICT',
    );
    const suggestion = await f.wiki.suggestOrganization(f.member, 'default-resources', {
      kind: 'directory',
      change: { ...org, expectedVersion: 1, nodes: [], entries: [], collections: [] },
    });
    expect((await f.wiki.community('resources')).entries).toHaveLength(2);
    await f.wiki.reviewOrganization(f.manager, suggestion.id, 'approve', '通过');
    await f.wiki.saveDirectory(f.admin, 'default-campus', {
      expectedVersion: 1,
      nodes: [],
      entries: [],
      collections: [],
    });
    expect(await f.wiki.read(p.id)).not.toBeNull();
  });
  it('follows approved route revisions and persists review reminders across retries', async () => {
    const f = await fixture();
    const p = await f.publish();
    const r = await f.wiki.saveRoute(f.manager, 'default-resources', {
      expectedVersion: 0,
      title: '初学路线',
      goal: '理解基础',
      steps: [{ id: 'step-1', pageId: p.id, goal: '了解概念', intro: '先读定义', position: 0 }],
    });
    expect((await f.wiki.route(r.routeId))?.steps[0]?.needsReview).toBe(false);
    await f.wiki.publish(f.admin, p.id, content('新正文', p.revisionId));
    expect((await f.wiki.route(r.routeId))?.steps[0]?.needsReview).toBe(true);
    await expect(f.wiki.confirmStep(f.manager, r.routeId, 'step-1', p.revisionId)).rejects.toThrow(
      'REVISION_CONFLICT',
    );
    await f.wiki.deliverPending();
    await f.wiki.deliverPending();
    expect(
      await f.db
        .selectFrom('admin_notifications')
        .selectAll()
        .where('user_id', '=', f.manager.actor!.userId)
        .execute(),
    ).toHaveLength(1);
    await f.wiki.confirmStep(f.manager, r.routeId, 'step-1', (await f.wiki.read(p.id))!.revisionId);
    expect((await f.wiki.route(r.routeId))?.steps[0]?.needsReview).toBe(false);
    const afterConfirm = (await f.wiki.read(p.id))!;
    const quick = await f.wiki.publish(
      f.admin,
      p.id,
      content('已及时复核的新稿', afterConfirm.revisionId),
    );
    await f.wiki.confirmStep(f.manager, r.routeId, 'step-1', quick.revisionId);
    await f.wiki.deliverPending();
    expect(
      await f.db
        .selectFrom('admin_notifications')
        .selectAll()
        .where('user_id', '=', f.manager.actor!.userId)
        .execute(),
    ).toHaveLength(1);
  });
  it('separates disputes from freezing, permits suggestions while frozen and controls purge', async () => {
    const f = await fixture();
    const p = await f.publish();
    const dispute = await f.wiki.raiseDispute(f.manager, p.id, '存在分歧，请复核来源');
    expect((await f.wiki.read(p.id))?.paused).toBe(false);
    await expect(
      f.wiki.decideDispute(f.manager, dispute.disputeId, { action: 'pause', reason: '复核中' }),
    ).rejects.toThrow();
    await f.wiki.decideDispute(f.admin, dispute.disputeId, { action: 'pause', reason: '复核中' });
    await expect(
      f.wiki.publish(f.manager, p.id, content('不能直发', p.revisionId)),
    ).rejects.toThrow('PUBLICATION_PAUSED');
    await f.wiki.submit(f.member, p.id, content('修改建议', p.revisionId));
    expect((await f.wiki.read(p.id))?.markdown).toContain('公开内容');
    await f.wiki.setVisibility(f.manager, p.id, true, '暂时隐藏');
    expect(await f.wiki.read(p.id)).toBeNull();
    expect(await f.wiki.history(p.id)).toEqual([]);
    expect((await f.wiki.search({ q: '测试', limit: 20 })).items).toEqual([]);
    await f.wiki.setVisibility(f.manager, p.id, false, '恢复');
    expect(await f.wiki.read(p.id)).not.toBeNull();
    await expect(f.wiki.purge(f.manager, p.id, '清除')).rejects.toThrow();
    await f.wiki.purge(f.admin, p.id, '测试清除');
    expect(await f.wiki.read(p.id)).toBeNull();
    expect(
      await f.db
        .selectFrom('knowledge_revisions')
        .selectAll()
        .where('page_id', '=', p.id)
        .execute(),
    ).toEqual([]);
  });
});
