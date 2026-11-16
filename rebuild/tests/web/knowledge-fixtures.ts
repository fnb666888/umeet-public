/** Disposable local browser fixture. Never points at the developer's content database. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createTestApp } from '../../apps/api/test/support/test-app.js';
import { CommunitiesService } from '../../apps/api/src/modules/communities/communities.service.js';
import { PasswordAuthService } from '../../apps/api/src/modules/identity/password-auth.service.js';
import { KnowledgeService } from '../../apps/api/src/modules/knowledge/knowledge.service.js';
import type { KnowledgeRevisionInput, RequestContext } from '../../packages/contracts/src/index.js';
const mini=process.argv.includes('--mini');
const url = 'mysql://root@127.0.0.1:19316/' + (mini?'umeet_rebuild_test_minibrowser':'umeet_rebuild_test_knowledgebrowser');
process.env.TEST_MYSQL_URL = url;
const h = await createTestApp();
try {
  await new CommunitiesService(h.db).seedDefaults();
  await h.db
    .insertInto('communities')
    .values({
      id: 'knowledge-physics',
      slug: 'physics',
      name: '物理学',
      description: '从基础、近似到应用的物理知识',
      display_order: 20,
    })
    .execute();
  const auth = new PasswordAuthService(h.db),
    wiki = new KnowledgeService(h.db),
    accounts: Record<
      string,
      { username: string; password: string; token: string; userId: string }
    > = {};
  for (const role of ['admin', 'member', 'manager', 'campus', 'unrelated', 'other']) {
    const username = 'knowledge_' + role,
      password = 'Knowledge local tests 84!';
    const result = await auth.register({ username, password }, 'knowledge-fixture-' + role);
    accounts[role] = { username, password, token: result.token, userId: result.actor.userId };
  }
  await h.db
    .insertInto('platform_roles')
    .values({ user_id: accounts.admin!.userId, role: 'admin' })
    .execute();
  for (const [role, board] of [
    ['manager', 'physics'],
    ['campus', 'daily'],
    ['unrelated', 'resources'],
  ] as const) {
    const id = 'knowledge-' + role;
    await h.db
      .insertInto('moderation_groups')
      .values({
        id,
        name: '知识维护 ' + role,
        boards: JSON.stringify([board]),
        permissions: JSON.stringify(['wiki.view', 'wiki.edit']),
      })
      .execute();
    await h.db
      .insertInto('moderation_group_members')
      .values({ group_id: id, user_id: accounts[role]!.userId })
      .execute();
  }
  const ctx: RequestContext = {
    actor: { userId: accounts.admin!.userId, kind: 'member', platformRoles: [] },
    requestId: 'knowledge-fixture',
  };
  const schema = z.object({
    key: z.string(),
    title: z.string(),
    summary: z.string(),
    markdown: z.string(),
  });
  const physics = z
    .array(schema.extend({ branch: z.string() }))
    .parse(JSON.parse(readFileSync('tests/fixtures/knowledge/physics.json', 'utf8')) as unknown);
  const manual = schema.parse(
    JSON.parse(readFileSync('tests/fixtures/knowledge/handbook.json', 'utf8')) as unknown,
  );
  const pages: Record<string, { id: string; revisionId: string }> = {};
  async function publish(
    key: string,
    data: { title: string; summary: string; markdown: string },
    template: 'handbook' | 'academic',
    relations: KnowledgeRevisionInput['relations'] = [],
  ) {
    const id = pages[key]?.id ?? (await wiki.create(ctx)).id;
    const p = await wiki.publish(ctx, id, {
      title: data.title,
      summary: data.summary,
      markdown: data.markdown,
      template,
      relations,
      baseRevisionId: pages[key]?.revisionId ?? null,
      changeNote: '验收样例：已核对资料与模型条件',
      idempotencyKey: randomUUID(),
    });
    pages[key] = { id: p.id, revisionId: p.revisionId };
    return p;
  }
  for (const item of physics) await publish(item.key, item, 'academic');
  const geo = physics.find((p) => p.key === 'geometry')!;
  await publish('geometry', geo, 'academic', [
    {
      type: 'prerequisite',
      targetPageId: pages.waves!.id,
      explanation: '先区分波长与相关结构尺度。',
    },
    {
      type: 'approximation_of',
      targetPageId: pages.em!.id,
      conditions: '相关结构尺度远大于波长，并需检查衍射、干涉等波动效应。',
      explanation: '保留光线传播方向等主要信息。',
      evidence: 'https://openstax.org/books/university-physics-volume-3/pages/2-introduction',
    },
    {
      type: 'applied_to',
      targetPageId: pages.lens!.id,
      conditions: '需进一步满足薄透镜和近轴等模型假设。',
      explanation: '用光线追迹分析成像。',
    },
    {
      type: 'related',
      targetPageId: pages.waves!.id,
      explanation: '用波长判断几何光学的尺度条件。',
    },
  ]);
  await publish('campus-network', manual, 'handbook');
  const nodes = ['基础理论', '近似理论', '实际应用'].map((title, position) => ({
    id: 'knowledge-physics-' + position,
    parentId: null,
    title,
    position,
  }));
  await wiki.saveDirectory(ctx, 'knowledge-physics', {
    expectedVersion: 0,
    nodes,
    collections: physics.map((p) => pages[p.key]!.id),
    entries: physics.map((p, position) => ({
      nodeId: nodes[p.branch === 'basic' ? 0 : p.branch === 'approximation' ? 1 : 2]!.id,
      pageId: pages[p.key]!.id,
      position,
    })),
  });
  await wiki.saveDirectory(ctx, 'default-resources', {
    expectedVersion: 0,
    nodes: [{ id: 'knowledge-shared', parentId: null, title: '跨学科学习资料', position: 0 }],
    collections: [pages.geometry!.id],
    entries: [{ nodeId: 'knowledge-shared', pageId: pages.geometry!.id, position: 0 }],
  });
  await wiki.saveDirectory(ctx, 'default-campus', {
    expectedVersion: 0,
    nodes: [{ id: 'knowledge-campus-life', parentId: null, title: '学习与生活指南', position: 0 }],
    collections: [pages['campus-network']!.id],
    entries: [
      { nodeId: 'knowledge-campus-life', pageId: pages['campus-network']!.id, position: 0 },
    ],
  });
  const route = await wiki.saveRoute(ctx, 'knowledge-physics', {
    expectedVersion: 0,
    title: '从波到薄透镜成像',
    goal: '分清基础描述、近似条件和具体应用，能说明薄透镜模型何时可用。',
    steps: physics.map((p, position) => ({
      id: 'knowledge-step-' + position,
      pageId: pages[p.key]!.id,
      goal: ['区分时间周期和空间周期', '认识经典电磁描述', '判断光线近似条件', '利用模型估算成像'][
        position
      ]!,
      intro: [
        '先确认频率、波长和相速度的含义。',
        '注意真空平面波的假设，不把特殊模型当成所有情形。',
        '先看近似条件，再阅读应用关系。',
        '核对近轴假设和符号约定，再代入示例。',
      ][position]!,
      position,
    })),
  });
  mkdirSync('.runtime', { recursive: true });
  writeFileSync(
    mini?'.runtime/mini-knowledge-fixture.json':'.runtime/knowledge-fixture.json',
    JSON.stringify({ databaseUrl: url, accounts, pages, routeId: route.routeId }, null, 2),
  );
  console.log(
    'Knowledge browser fixture ready in isolated local database; accounts are stored only in ignored runtime file.',
  );
} finally {
  await h.close();
}
