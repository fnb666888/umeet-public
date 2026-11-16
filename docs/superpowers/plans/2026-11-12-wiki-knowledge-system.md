# Wiki Knowledge System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 一次完整交付可公开阅读、社区共建的共享知识库，同时跑通校园手册与物理知识学习场景。

**Architecture:** 在现有工程内新增 knowledge 领域模块，采用共享词条、不可变修订和独立候选提案；社区通过收录、目录和路线组织同一份正文。复用现有 Markdown／公式／差异能力，重新实现全站正文治理和社区组织权限，不继承旧 Wiki 的单社区归属限制。

**Tech Stack:** 现有 TypeScript、Next.js／React、NestJS、Kysely／MySQL、Zod、Milkdown、remark-math／KaTeX、Vitest 与 Python 浏览器测试工具链。沿用工程 Node 版本要求，不在本计划中升级依赖。

**Spec:** [正式设计方案](../specs/2026-11-12-wiki-knowledge-system-design.md)。执行者须先读方案；本文的文件名、接口和错误码是实施建议，不应当作用户另行确认的产品要求。

## Global Constraints

- 完整能力一起开放，不拆成对用户分阶段上线。
- 新 Wiki 独立建设，旧内容由人工搬运。
- 不设专属维护团队；任何社区中拥有有效 Wiki 管理权限的人员均可治理全站正文，不要求该社区收录该词条。
- 目录和路线由本社区具有 Wiki 管理权限的人员维护，普通成员提建议。
- 普通成员修改先审核；Wiki 管理人员可直接发布；正文、知识关系和条件说明一起审核、一起版本化。
- 只展示最后编辑时间；不增加最近核实、到期复核或到期自动下架机制。
- 草稿与待审版本不进入公开搜索；管理员身份不自动赋予他人私人草稿读取权。
- 旧版本稿件必须核对最新差异，再确认发布，不能覆盖他人修改。
- 标记不自动冻结；暂停／恢复直接发布和永久清除仅全站管理员执行。
- 只修改本任务文件；不覆盖工作区已有改动，不执行旧数据删除或自动迁移。

## Review Focus

1. 多设备草稿与切换账号：迟到的保存响应不能把甲的稿件写入乙账号，也不能覆盖另一设备的新稿。任务 4、9 覆盖。
2. 审核与冻结同时发生：鉴权和状态校验必须在提交事务中生效，不能先读后写绕过冻结或撤权。任务 2、3、8 覆盖。
3. 发布、隐藏与路线通知并发：提醒可重试且不会重复堆积，复核旧修订不能抹掉新修订的待复核状态。任务 7、8 覆盖。
4. 标题、别名与内部链接有歧义：同名词条保留限定，含糊别名列候选，重命名不改稳定引用身份。任务 2、9 覆盖。
5. 新建词条尚无发布版：私人草稿与待审词条不得经列表、关系选择器、历史、预览、反链或缓存泄露。任务 2、3、8、11 覆盖。

---

## 文件与执行约定

以下路径均相对于仓库根目录 `/path/to/project`。新模块后端位于 `rebuild/apps/api/src/modules/knowledge/`，前端位于 `rebuild/apps/web/src/components/knowledge/`，接口契约位于 `rebuild/packages/contracts/src/knowledge.ts`。每个文件按下列任务承担单一职责，不往现有大型 Wiki 组件继续堆叠新逻辑。

命令均在 `rebuild/` 执行。任务中的测试代码是要写入的关键断言，使用各任务测试文件中的 `setup()` 真实数据库夹具；`f` 代表该夹具，不能用固定返回值代替权限、事务或查询实现。每项先运行新增测试确认因目标行为缺失而失败，实现后用同一命令确认通过；已有测试失败需先核对基线。本计划未执行这些未来检查。

完成一个任务后复核差异，只提交该任务文件；如执行阶段采用 Git 提交，使用下方指定提交主题，不混入用户原有修改。数据库迁移目前最大编号为 031，建议新增 032；实际执行前再次检查编号占用，若已占用则顺延并同步计划及测试引用。

### Task 1: 数据模型与共享契约

**Files:** 新建 `rebuild/packages/contracts/src/knowledge.ts`、`rebuild/packages/contracts/test/knowledge.test.ts`、`rebuild/apps/api/src/database/migrations/032_knowledge.ts`、`rebuild/apps/api/test/knowledge-schema.int.test.ts`；修改 `rebuild/packages/contracts/src/index.ts`、`rebuild/apps/api/src/database/database.types.ts`，按现有迁移注册方式接入。

**Interfaces:** 导出 `KnowledgeRelationInput`、`KnowledgeRevisionInput`、`KnowledgeDraftInput`、`KnowledgeProposal`、`KnowledgePage`、`KnowledgeSearchInput`、`KnowledgeDirectoryChange`、`KnowledgeRouteInput`、`KnowledgeDisputeDecision` 及对应 Zod schema。关系枚举固定 `prerequisite | approximation_of | applied_to | related`；模板 `plain | handbook | academic`；修订输入含 `baseRevisionId: string | null`、`title`、`summary`、`markdown`、`template`、`relations`、`changeNote`、`idempotencyKey`。路线上每步包含 `pageId`、`goal`、`intro`、`position`，路线自身含目标及标题。目录／路线变更均有组织版本号；草稿保存有草稿版本号。

- [x] 写 schema 与迁移测试：`expect(relationKinds).toEqual(['prerequisite','approximation_of','applied_to','related'])`；第五种关系校验失败；`expect(await f.countPublishedPages()).toBe(0)`；插入没有社区归属的词条成功；孤立目录引用和重复收录约束生效。
- [x] 运行 `npx vitest run packages/contracts/test/knowledge.test.ts apps/api/test/knowledge-schema.int.test.ts`，确认目标测试失败。
- [x] 建立 `knowledge_pages/revisions/proposals/drafts/aliases/revision_relations/collections/directory_nodes/directory_entries/organization_proposals/routes/route_revisions/route_steps/route_reviews/disputes/events/notification_outbox` 表；草稿／提案／组织建议与公开修订物理分开，正文只能由发布指针选出。预留隐藏／暂停状态、幂等唯一约束、稳定 ID 和查询索引；新表迁移不改写旧 Wiki 表。目录、路线操作有组织审计记录。
- [x] 重跑该命令，预期全部通过；在独立测试库验证空库迁移与从 031 升级均成功。提交主题：`feat: define shared knowledge model`。

### Task 2: 权限、公开查询、同名与别名解析

**Files:** 新建 `rebuild/apps/api/src/modules/knowledge/knowledge-access.ts`、`knowledge-read.service.ts`、`knowledge.controller.ts`、`rebuild/apps/api/test/knowledge-access.int.test.ts`、`knowledge-read.int.test.ts`；修改 `rebuild/apps/api/src/app.module.ts`、`rebuild/apps/web/src/app/api/backend/[...path]/route.ts`。

**Interfaces:** `KnowledgeAccess.assertGlobalWikiManager(ctx: RequestContext): Promise<void>`，`assertCommunityOrganizer(ctx: RequestContext, communityId: string): Promise<void>`，`assertSiteAdmin(ctx: RequestContext): Promise<void>`，`capabilities(ctx: RequestContext, communityId?: string): Promise<{canContribute: boolean; canGovernBody: boolean; canOrganizeCommunity: boolean; isSiteAdmin: boolean}>`；`KnowledgeReadService.readPublished(pageId: string): Promise<KnowledgePage | null>`、`search(input: KnowledgeSearchInput): Promise<{items: KnowledgePage[]; nextCursor: string | null}>`、`resolveTitle(title: string): Promise<{pageIds: string[]}>`。`KnowledgePage` 仅为公开载荷，不能包含草稿或提案；注册 `/api/v1/knowledge` 及前端受控代理路径。

- [x] 写权限／查询测试：`await expect(f.managerFromUnrelatedCommunityCanReview()).resolves.toBe(true)`；`await expect(f.editOtherCommunityDirectory()).rejects.toMatchObject({code:'FORBIDDEN'})`；`expect(await f.guestSearch('private-needle')).toEqual([])`；同名解析返回两个候选；撤权或团队暂停后原会话的管理请求被拒绝。
- [x] 运行 `npx vitest run apps/api/test/knowledge-access.int.test.ts apps/api/test/knowledge-read.int.test.ts`，确认失败。
- [x] 从现有有效授权和账号状态解析管理资格，不增加“所属社区必须收录”条件；公开查询仅返回发布且未隐藏内容。正文、摘要、选择器、历史与反链统一走可见性规则；标题不承担主键职责。重命名在发布事务中保留别名，所有写接口在实际写入时重新核验权限。
- [x] 重跑上述测试，预期通过。提交主题：`feat: add knowledge access and public queries`。

### Task 3: 提案、审核、直接发布与版本冲突

**Files:** 新建 `rebuild/apps/api/src/modules/knowledge/knowledge-publish.service.ts`、`knowledge-proposals.service.ts`、`rebuild/apps/api/test/knowledge-publish.int.test.ts`；修改 `knowledge.controller.ts`。

**Interfaces:** `KnowledgeProposalsService.submit(ctx: RequestContext, pageId: string, input: KnowledgeRevisionInput): Promise<KnowledgeProposal>`；`review(ctx: RequestContext, proposalId: string, input: {decision: 'approve' | 'return'; reason: string; expectedPublishedRevisionId: string | null; idempotencyKey: string}): Promise<KnowledgeProposal>`；`KnowledgePublishService.publish(ctx: RequestContext, pageId: string, input: KnowledgeRevisionInput): Promise<KnowledgePage>`。新建提案先取得稳定 pageId，但未发布词条不公开；冲突返回 `REVISION_CONFLICT` 和当前修订 ID。

- [x] 写事务测试：`expect(await f.publicBodyAfterMemberSubmit()).toBe('old')`；`expect(await f.otherMemberCanReadProposal()).toBe(false)`；两次并发审核仅生成一个公开修订；`await expect(f.publishFromStaleBase()).rejects.toMatchObject({code:'REVISION_CONFLICT'})`；退回无原因失败，补充后可重提；新词条未批准前搜索无结果。
- [x] 运行 `npx vitest run apps/api/test/knowledge-publish.int.test.ts`，确认失败。
- [x] 用数据库事务锁定词条发布指针，原子完成权限／冻结／基准检查、生成不可变修订、关系快照、提案状态与事件记录。幂等重试返回原结果；重放相同幂等键但不同内容拒绝。普通成员只能提交；管理人员直接发布与批准提案共用发布内核；回退也作为新修订并检查基准，不能改写历史。
- [x] 重跑测试，预期通过。提交主题：`feat: implement reviewed knowledge publishing`。

### Task 4: 服务端私人草稿与恢复

**Files:** 新建 `rebuild/apps/api/src/modules/knowledge/knowledge-drafts.service.ts`、`rebuild/apps/api/test/knowledge-drafts.int.test.ts`；修改 `knowledge.controller.ts`。

**Interfaces:** `KnowledgeDraftsService.save(ctx: RequestContext, input: KnowledgeDraftInput): Promise<{draftId: string; version: number; savedAt: string}>`、`readOwn(ctx: RequestContext, draftId: string): Promise<KnowledgeDraftInput | null>`；草稿输入含完整编辑载荷、`editingTaskId`、`expectedVersion`，不含可被客户端冒充的 ownerId。

- [x] 写恢复测试：`expect(await f.restoreAfterRelogin()).toMatchObject({title:'草稿标题', markdown:'未提交正文', relations:f.savedRelations})`；`expect(await f.adminReadsOthersDraft()).toBeNull()`；两个设备用同一草稿版本保存仅一个成功，另一个为 `DRAFT_CONFLICT`；提交失败不清稿，成功归档；不同编辑任务相互隔离。
- [x] 运行 `npx vitest run apps/api/test/knowledge-drafts.int.test.ts`，确认失败。
- [x] 服务端按当前账号授权、版本比较并保存完整稿件；读取／写入／删除均 owner-only。提案提交与对应草稿归档具备一致性，不把普通自动保存写成公开修订。
- [x] 重跑测试，预期通过。提交主题：`feat: persist private knowledge drafts`。

### Task 5: 关系校验、反向展示与引用

**Files:** 新建 `rebuild/apps/api/src/modules/knowledge/knowledge-relations.service.ts`、`rebuild/apps/api/test/knowledge-relations.int.test.ts`；修改 `knowledge-publish.service.ts`、`knowledge-read.service.ts`。复用前先读 `rebuild/packages/markdown/src/remark-wiki-links.ts` 的解析约束。

**Interfaces:** `KnowledgeRelationsService.validate(pageId: string, relations: KnowledgeRelationInput[]): Promise<void>`、`listPublished(pageId: string): Promise<{outgoing: KnowledgeRelationInput[]; incoming: {sourcePageId: string; relation: KnowledgeRelationInput}[]}>`。每条关系含 `type`、`targetPageId`、可选 `conditions`、`explanation`、`evidence`；反向结果另带来源词条身份；发布校验需在任务 3 的事务连接内执行。

- [x] 写关系测试：`expect(await f.publicConditionsAfterPendingEdit()).toBe('original')`；先修自环／间接环被拒绝；并发互加先修不能同时形成环；相关知识允许普通环但不重复显示；`expect(await f.appliedToReverseLabel()).toBe('采用的理论')`；草稿关系不产生公开反链。
- [x] 运行 `npx vitest run apps/api/test/knowledge-relations.int.test.ts`，确认失败。
- [x] 四类关系按方案方向展示，正文引用与类型关系分别索引；先修图校验在发布事务中序列化必要的图变更，不能仅靠事务外遍历。隐藏目标仅输出不可用身份，不回传其摘要或正文。关系更新只通过完整修订发布，拒绝独立绕审写入口。
- [x] 重跑测试，预期通过。提交主题：`feat: add versioned knowledge relations`。

### Task 6: 社区收录、目录与组织建议

**Files:** 新建 `rebuild/apps/api/src/modules/knowledge/knowledge-directories.service.ts`、`knowledge-organization-proposals.service.ts`、`rebuild/apps/api/test/knowledge-directories.int.test.ts`；修改 `knowledge.controller.ts`。

**Interfaces:** `KnowledgeDirectoriesService.apply(ctx: RequestContext, communityId: string, input: KnowledgeDirectoryChange): Promise<{version: number}>`；变更类型为收录／取消收录、节点增改移删、条目增删与排序。`KnowledgeOrganizationProposalsService.submit(ctx: RequestContext, communityId: string, input: {kind: 'directory' | 'route'; change: KnowledgeDirectoryChange | KnowledgeRouteInput}): Promise<{id: string}>`、`review(ctx: RequestContext, proposalId: string, decision: 'approve' | 'return', reason: string): Promise<void>`，审查者限对应社区授权人员或全站管理员。

- [x] 写组织测试：`expect(await f.articleCopiesAfterTwoCollections()).toBe(1)`；取消最后一个收录后公开正文仍存在；一个词条能进多个目录并分别排序；移动到后代目录失败；普通成员提建议不立即改变公开目录，跨社区管理员无法批准；陈旧目录版本不能覆盖新排序。
- [x] 运行 `npx vitest run apps/api/test/knowledge-directories.int.test.ts`，确认失败。
- [x] 实现目录树、收录与建议队列；节点删除只解除目录挂载，明确提示后代条目影响，不删除共享正文。组织调整保留版本与操作者，建议批准也核验组织基准；目录结构不硬编码物理学分类。
- [x] 重跑测试，预期通过。提交主题：`feat: organize knowledge by community directories`。

### Task 7: 学习路线、更新复核与持久化提醒

**Files:** 新建 `rebuild/apps/api/src/modules/knowledge/knowledge-routes.service.ts`、`knowledge-notifications.service.ts`、`rebuild/apps/api/test/knowledge-routes.int.test.ts`；修改 `knowledge.controller.ts`、`knowledge-publish.service.ts`、`knowledge-organization-proposals.service.ts`，按现有任务调度机制接入提醒投递。

**Interfaces:** `KnowledgeRoutesService.save(ctx: RequestContext, communityId: string, input: KnowledgeRouteInput): Promise<{routeId: string; version: number}>`、`confirmStep(ctx: RequestContext, routeId: string, stepId: string, observedRevisionId: string): Promise<void>`；`KnowledgeNotificationsService.deliverPending(): Promise<{delivered: number}>`。组织建议调用同一保存服务，不另写一条绕过校验的路径。

- [x] 写路线测试：路线顺序／目标／导读独立于目录；`expect(await f.routeBodyAfterArticleUpdate()).toBe('new-approved')`；`expect(await f.routeNeedsReview()).toBe(true)`；旧 revisionId 复核不能消除新提醒；服务重启后补投，重复消费不重复提醒；普通成员路线建议只有本社区审核通过后生效。
- [x] 运行 `npx vitest run apps/api/test/knowledge-routes.int.test.ts`，确认失败。
- [x] 步骤只引用稳定词条 ID，读取最新发布版；比对当前修订与维护者确认修订计算复核状态。正文发布事务写持久化通知任务，消费者幂等投递给当前有效路线维护者；未完成期间读端仍能判断待复核。路线删除、隐藏目标与撤权不应使通知重试永久报错。
- [x] 重跑测试，预期通过。提交主题：`feat: add learning routes and revision review`。

### Task 8: 争议、隐藏恢复与永久清除

**Files:** 新建 `rebuild/apps/api/src/modules/knowledge/knowledge-governance.service.ts`、`rebuild/apps/api/test/knowledge-governance.int.test.ts`；修改 `knowledge.controller.ts`、`knowledge-publish.service.ts`、`knowledge-read.service.ts`、`knowledge-notifications.service.ts`。

**Interfaces:** `KnowledgeGovernanceService.raiseDispute(ctx: RequestContext, pageId: string, reason: string): Promise<{disputeId: string}>`、`decideDispute(ctx: RequestContext, disputeId: string, input: KnowledgeDisputeDecision): Promise<void>`、`setVisibility(ctx: RequestContext, pageId: string, hidden: boolean, reason: string): Promise<void>`、`purge(ctx: RequestContext, pageId: string, reason: string): Promise<void>`。争议决定含暂停／恢复／复核发布动作及依据；复核发布复用任务 3 内核，必须有最新基准。

- [x] 写治理测试：`expect(await f.frozenAfterRaiseDispute()).toBe(false)`；Wiki 管理人员暂停请求被拒绝；冻结期间保留公开版并允许提案，普通批准／直接发布被拒绝；隐藏后读／历史／反链／预览／搜索均无隐藏正文；恢复可读；非全站管理员永久清除失败；并发冻结先提交后，迟到的发布不能生效。
- [x] 运行 `npx vitest run apps/api/test/knowledge-governance.int.test.ts`，确认失败。
- [x] 争议状态与发布暂停分开持久化；管理事件记录理由和依据。隐藏／恢复同步失效公开缓存并处理路线状态；公开读端再次校验状态，不以异步清缓存作为唯一隐私屏障。清除后保留无正文的不可用标识，删除受影响正文载荷、索引及草稿内容，禁止 ID 复用；实际永久清除不在本轮文档任务内执行。
- [x] 重跑测试，预期通过。提交主题：`feat: govern shared knowledge safely`。

### Task 9: 统一阅读器与编辑体验

**Files:** 新建 `rebuild/apps/web/src/components/knowledge/{KnowledgeHome,KnowledgeArticle,KnowledgeComposer,RelationEditor,KnowledgeConflict,KnowledgeHistory,KnowledgeDiscussion}.tsx`、`useKnowledgeDraft.ts`、`knowledge-client.ts`、`knowledge.css`；新建 `rebuild/apps/web/src/app/knowledge/page.tsx`、`[id]/page.tsx`、`[id]/edit/page.tsx`、`new/page.tsx`、`rebuild/apps/web/test/knowledge-editor.test.tsx`、`knowledge-render.test.tsx`。后端新增 `rebuild/apps/api/src/modules/knowledge/knowledge-discussions.service.ts`、`rebuild/apps/api/test/knowledge-discussions.int.test.ts`，复用讨论能力前核对其对象可见性。

**Interfaces:** `KnowledgeComposer({pageId?: string, draftId?: string}): ReactElement`；`useKnowledgeDraft({accountId: string, editingTaskId: string})` 返回稿件、`saveState: 'saving' | 'saved' | 'failed' | 'conflict'` 和 `retry()`。阅读、发布、提案、草稿、关系与历史分别调用任务 2–5、8 API；公开纠错讨论不承载私人待审内容。

- [x] 写界面测试：`expect(screen.getByText('保存失败')).toBeVisible()`；晚到的账号甲保存响应不更新账号乙界面；恢复全载荷，离开未保存页面提示；过期稿展示双方差异并保留本地稿；手册无需学科字段；公式、表格、图片正常，脚本链接和 HTML 不执行。讨论测试断言匿名可读已发布词条讨论，登录才可贡献，隐藏词条不可通过讨论接口读取正文／附件引用。
- [x] 运行 `npx vitest run apps/web/test/knowledge-editor.test.tsx apps/web/test/knowledge-render.test.tsx apps/api/test/knowledge-discussions.int.test.ts`，确认失败。
- [x] 执行前按 `rebuild/apps/web/AGENTS.md` 阅读本地 Next.js 对应指南。提取并复用现有 `components/wiki/WikiEditor.tsx`、`RevisionDiff.tsx`、`ConflictResolver.tsx` 与 Markdown 安全能力，提供统一模板、公式预览、目标词条选择器、别名候选、历史／差异／回退、讨论／纠错。撤销待发保存、账号变化清除本地敏感状态；保存成功仅依据服务器确认，网络失败保留稿件。普通成员主操作“提交审核”，管理员主操作“发布”，冻结时使用提案入口。
- [x] 重跑测试，预期通过；人工检查窄屏、键盘焦点、输入标签、长公式横向溢出、加载／空／失败／重试。提交主题：`feat: build knowledge reading and authoring experience`。

### Task 10: 社区组织界面、管理界面与统一入口

**Files:** 新建 `rebuild/apps/web/src/components/knowledge/{CommunityKnowledge,DirectoryEditor,LearningRoute,RouteEditor,KnowledgeReviewQueue,OrganizationReviewQueue,KnowledgeGovernance}.tsx`、`rebuild/apps/web/src/app/c/[slug]/knowledge/page.tsx`、`rebuild/apps/web/src/app/knowledge/routes/[id]/page.tsx`、`rebuild/apps/web/src/app/knowledge/manage/page.tsx`、`rebuild/apps/web/test/knowledge-management.test.tsx`；修改 `rebuild/apps/web/src/components/community/Application.tsx` 的 Wiki 导航接线。

**Interfaces:** `CommunityKnowledge({communityId: string}): ReactElement`、`LearningRoute({routeId: string}): ReactElement`；前端依据任务 2 的能力响应显示操作，服务端仍独立鉴权。管理页面分全站正文队列与本社区组织队列，分别调用对应 API。

- [x] 写管理测试：未收录词条也能进入全站审核；管理 A 社区的人不能编辑 B 的目录／路线；普通成员有建议入口；目录能在多处收录；路线每步有目标／导读／复核提示；争议标记与暂停操作文案分明；永久清除显示不可恢复和影响范围。
- [x] 运行 `npx vitest run apps/web/test/knowledge-management.test.tsx`，确认失败。
- [x] 实现两种阅读入口、目录移动排序及同词条复用、路线维护、组织建议、提案差异审核、退回理由和争议治理。提供键盘可用的排序操作，不仅支持拖拽。建设期新入口由试运行配置控制；任务 11 完成前不切换面向所有用户的主导航，不删除旧入口或数据。
- [x] 重跑测试，预期通过。提交主题：`feat: integrate community knowledge and governance UI`。

### Task 11: 真实样例、端到端验收与单次开放关口

**Files:** 新建 `rebuild/tests/web/knowledge.py`、`rebuild/tests/fixtures/knowledge/physics.json`、`handbook.json`、`rebuild/docs/knowledge-acceptance.md`；按现有 `rebuild/tests/web/run.py` 约定接入。正式开放时再修改任务 10 的导航配置。

**Interfaces:** 两份样例只导入独立测试／预发布环境；样例记录来源与人工核对结论。端到端覆盖游客、普通成员、三个不同社区 Wiki 管理人员、全站管理员与撤权账号，禁止靠赋予所有人站长权限通过测试。

- [x] 编写失败的真实接口浏览器流程：物理三个自定义分支、公式与四类带说明关系、完整学习路线；校园步骤手册、目录搜索与纠错；两社区共享、一未收录社区管理人员审核；退回重提、双窗口冲突、跨登录草稿恢复、争议复核、隐藏恢复、别名、路线更新提醒。断言未发布、待审、私人草稿与隐藏内容不经公开 API、HTML、预览或客户端缓存泄露。
- [x] 在隔离环境运行 `python tests/web/knowledge.py`，确认尚缺行为导致失败；样例内容须来自可核对的实际资料，校园流程不能编造，也不能仅用占位内容通过场景验收。物理样例核对公式与适用条件，不以管理员身份替代内容核验。
- [x] 补齐集成问题，记录每场景账号、操作、预期／实际、截图、修复回归、遗留项。旧 Wiki 内容是否人工搬运是单独运营工作，不使新库验收伪装成已完成迁移。
- [x] 执行 `npm run typecheck`、`npm test`、`npm run build:api`、`npm run build:web`、`python tests/web/knowledge.py`；预期均通过，且没有跳过关键测试。另跑现有 `python tests/web/wiki.py` 验证旧阅读链路未被新接线意外破坏；该脚本的环境配置按现有测试说明提供。
- [x] 按正式方案第 8 节逐行验收，两类样例和协作流程全部通过后才将主导航切向新 Wiki；部署／公开开放另按执行时授权与环境规则办理。本计划没有授权自动部署。提交主题：`test: verify complete knowledge workflows`。

## 需求覆盖与交接

| 正式方案 | 对应任务 |
| --- | --- |
| 全站共享、零社区收录也存续、新建而非迁移 | 1、2、6、11 |
| 全站正文权限、社区组织权限、撤权 | 2、3、6、7、8、10 |
| 模板、公式、链接、同名／别名、讨论纠错、历史 | 2、3、5、9、11 |
| 待审隐私、退回重提、并发、不可变修订 | 1、2、3、5、8、9、11 |
| 跨刷新／登录／设备草稿与失败恢复 | 4、9、11 |
| 四类结构化关系、条件及同版本审核 | 1、3、5、9、11 |
| 多处目录、组织建议、学习路线、更新复核 | 6、7、10、11 |
| 争议、暂停、复核、隐藏恢复、永久清除权限 | 3、8、10、11 |
| 手册仅最后编辑时间；完整验收后一次开放 | 9、10、11 |

设计自检：已逐项映射正式方案，Review Focus 五项均有测试归属。2026-11-12 已完成功能实现；以上任务按交付状态勾选，原步骤保留为设计记录，实际代码划分、检查命令与调整以实施记录为准。未迁移或删除旧内容，未部署线上。


## 2026-11-12 实施完成记录

11 项功能任务均已在本地实现并验收。实际 API 用例集中于 `rebuild/apps/api/test/knowledge.int.test.ts`，发布与提案共用 `KnowledgePublishService` 的事务内核；增加 `033_knowledge_links` 保存独立正文反链，路线复核状态使用步骤上的已确认修订。页面与入口已接入，完整浏览器流程覆盖两类样例及协作治理。

- 全量回归：51 个文件、177 项测试通过。
- Wiki 专项：4 个文件、20 项测试通过。
- 类型检查、API 构建、Web 生产构建及真实浏览器流程通过。
- 构建并行度限制为 2，避免本机默认 19 个 worker 耗尽内存。
- 原旧 Wiki 浏览器脚本的适用页面已在前序工作中重定向；本轮改以实际 hash 入口验证旧阅读与新导航，全量 API 测试继续覆盖旧服务，未删除该脚本。
- 未创建 Git 提交，避免混入工作区原有改动；未执行线上迁移或部署。

完整证据与本地运行方式见 [实施与验收记录](../../../rebuild/docs/knowledge-acceptance.md)。
