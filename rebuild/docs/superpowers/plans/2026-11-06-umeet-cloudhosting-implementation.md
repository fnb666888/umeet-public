# Umeet 微信云托管重建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付面向公众的六个默认社区、用户申请社区和独立 Markdown Wiki，网站与原生小程序共用业务后端，并在微信云托管直接替换旧系统。

**Architecture:** Next.js 网站与 `/admin` 部署为一个服务，NestJS API 与 MySQL 持久化任务处理器部署为另一个服务。MySQL 保存业务数据，文件使用独立对象存储；按用户 2026-11-07 的最新决定，认证、会话及业务权限由 NestJS/MySQL 统一管理，不另接 CloudBase。两端界面独立开发，不复用旧产品代码和表结构。

**Tech Stack:** React、Next.js、NestJS、TypeScript strict、微信原生小程序、MySQL、npm workspaces；实施默认使用 Kysely/mysql2、Zod、Vitest、Playwright，库与运行时的精确版本在任务 1 验证后锁定。网站 Markdown 编辑器按任务 1 的验证结果选定，不预先承诺某库满足小程序。

**Spec:** [已确认的统一设计](../specs/2026-11-06-umeet-cloudhosting-design.md)。执行前同时读取本文、设计及各任务涉及的平台技能。用户已确认设计与计划，并选择在当前聊天原生逐项执行，最后独立整体审阅。后续明确决定以本段及执行记录为准。

起草日期：2026-11-06；自检完成日期：2026-11-07（Asia/Shanghai）。共 18 个任务，以下复选框均表示未来执行步骤，未勾选不代表已经运行。

## Global Constraints

- 首页固定：树洞、交易、资源、问答、搭子与活动、校园日常；正式用户申请新社区，平台批准，负责人邀请版主。
- 未登录可浏览；游客可收藏、保留记录/草稿，但不能公开发布、评论或修改 Wiki；升级保留数据。
- 微信、邮箱验证码、手机验证码、用户名密码四种登录和常见注册方式均是验证要求，不强制所有人先走同一渠道注册。
- 每社区独立 Wiki；Markdown 源格式；双端可视化/源码编辑、历史、差异、回滚与引用；普通修订即时公开。
- 保存检查基础版本，冲突人工合并；回滚产生新版本，不删除历史；不引入实时共同编辑服务。
- 常规帖子/评论/资源自动检查后公开，疑似转人工；文件检查通过才公开下载。
- 树洞三种署名可选；只有所有者及指定平台管理员可有理由地查询账号关联，并记录审计。
- 单文件 **100 MB**，单账号每日累计 **200 MB**，后台可调。工程单位统一按十进制 MB；业务日为 Asia/Shanghai，数据库时间保存 UTC。
- 微信云托管两个正式服务，网站/API 各至少一个运行实例；API 内执行 MySQL 持久化任务；不额外引入 Redis、专用搜索或独立 Worker。
- GitHub 私有单仓库；自动检查，测试后由用户确认生产发布；网站/API 分别发布，应用镜像回退与数据库变更分开处理。
- 旧数据不迁移，不要求保留或新旧并行；新系统准备完成后直接替换明确的旧入口，不删除无关项目或共享数据库实例。
- 个人维护，首版运维告警只发邮件。费用按微信云托管重新核算，300 元/月目标与 500 元以内备选比较，不套用虚拟机价格。
- 验证目标：1000 注册账号、200 日活、20 人同时操作；容量测算为数据库 5 GB、文件 50 GB、资源下载 100 GB/月，不表示已经承载验证。
- RPO 1 小时、发现后 RTO 4 小时及每月恢复演练是待验证目标；自管宿主机、双地区和精细灾备扩展暂缓。
- 不以 `any`、空 catch 或跳过失败测试掩盖问题；生产无假登录、假审核、假下载或演示用户后门。

## Review Focus

1. 游客持有有效认证 UID、或绑定到已有账号：不得因此获得正式写入权限；不能窃取其他用户的收藏或身份。归任务 3。
2. 两人同时保存、请求重试或旧页面回滚：不覆盖已提交修订，不重复创建业务版本，冲突保留本次草稿。归任务 7/8。
3. 匿名作者通过搜索、回复、通知、文件元数据或错误响应泄露：所有公开输出都只使用允许的署名。归任务 10/14。
4. 并发上传、跨日重试、文件检查未完成：额度不能超卖，重复确认不重复扣额，未通过文件不可下载。归任务 6。
5. 延迟检查结果、任务崩溃和重复回调：不得公开已被编辑/下架的旧版本，不重复通知，不出现无人持有却永久卡住的任务。归任务 5/13。

## 执行范围、目录与顺序

计划和设计保存在当前仓库。**正式新代码根目录记作 R：`/path/to/project`**；除下列明确缩写，本计划的代码路径均相对 R。R 是开发隔离目录，不代表线上保留新旧两套服务。执行任务 1 时把已确认设计、计划及相关Demo说明复制到 R 的 `docs/` 并核对来源。R 使用独立 Git 仓库，后续任务提交均在 R 中进行；它最终成为 GitHub 私有仓库的根，只上传新代码与必要文档，不把旧根目录里的密钥、`.data`、旧资源或整个未跟踪工作区上传。父仓库不暂存这个嵌套仓库。

路径缩写：`modules/` = `apps/api/src/modules/`；任务中未带目录的 SQL 迁移均位于 `apps/api/src/database/migrations/`；API 的 `test/` = `apps/api/test/`。任务 9/16 的 `components/`、`services/` 和 `test/` 则相对 `apps/miniprogram/src/`、`apps/miniprogram/src/`、`apps/miniprogram/`；任务 15 的 `components/` 相对 `apps/web/src/`。`tests/web`、`tests/mini` 始终相对 R，不作缩写。

任务 1 才创建 R。当前没有搭建新项目、安装依赖或操作云环境。若执行方式使用工作树，先遵守执行技能的工作树规范；当前根仓库有大量未跟踪旧文件，不可使用 `git clean` 清理它们。

```text
R/
  apps/web/                       Next.js 用户网站与 /admin
  apps/api/src/modules/           按业务划分的 NestJS 模块
  apps/api/src/database/          Kysely 类型、连接、迁移
  apps/api/test/                  MySQL 集成与权限测试
  apps/miniprogram/src/           原生页面、组件、接口客户端
  packages/contracts/src/         Zod DTO、公共响应/错误与业务类型
  packages/markdown/src/          Markdown 规范、语义 AST 与引用工具
  tests/web/                     Playwright 端到端流程
  tests/mini/                    开发者工具/真机流程
  probes/                        可丢弃的平台/编辑器验证
  deploy/web/ deploy/api/         分别构建的 Dockerfile 与部署模板
  scripts/                       验证、构建、迁移、发布、探活
  docs/decisions/ docs/evidence/  选型依据、脱敏证据和操作记录
```

默认新增决策：Kysely/mysql2 的类型化 SQL 便于显式管理 MySQL 事务和全文索引；不是沿用旧 ORM。SQL 迁移只在发布步骤运行，不让所有 API 实例启动时抢跑迁移。MySQL DDL 不依赖“事务失败即可完整回滚”的假设。

任务按 1→2→3→4→5→6→7→8→9→10→11→12→13→14→15→16→17→18 执行。认证、云资源或平台资格阻塞时，仅停止依赖该能力的任务；数据库、Markdown 与业务规则可在隔离测试环境继续，但最终完整首版不可跳过阻塞验收。

## 公共接口与验证约定

任务 2 定义并导出以下契约，后续保持名称一致：

```ts
type Actor = { userId: string; kind: 'guest' | 'member'; platformRoles: string[] };
type RequestContext = { actor: Actor | null; requestId: string };
type CursorPage<T> = { items: T[]; nextCursor: string | null };
type ApiProblem = { code: string; message: string; requestId: string; details?: unknown };
type SaveRevisionInput = { title: string; markdown: string; baseRevisionId: string | null;
  changeNote: string; idempotencyKey: string };
type WikiRevisionDto = { id: string; pageId: string; title: string; markdown: string;
  changeNote: string; authorAlias: string; createdAt: string; previousRevisionId: string | null };
```

ID 为服务端生成的不透明字符串，DTO 不暴露数据库内部身份字段。所有业务入口经运行时验证；会修改内容的请求有鉴权、作用域与幂等/版本检查，不能仅靠隐藏按钮。

所有下列 `npm` 命令工作目录为 R。任务 1/2 建立已存在工作区的脚本，后续任务创建对应包时补齐脚本：`check`（类型/规则/构建）、`test:contracts`、`test:api`、`test:markdown`、`test:web`、`test:mini`、`e2e:web`、`e2e:mini`、`db:migrate:test`、`verify:capabilities`。工作区未创建时不伪造测试成功。传递的测试文件路径相对该脚本所在包；测试必须连接可丢弃 MySQL 测试库，不能使用生产连接。

类型归属：任务 2 的 contracts 定义公共 DTO/error/schema；任务 3 的 `identity/auth-provider.ts` 定义 `VerifiedIdentity`（provider、subject、guest/member类别）、`LinkProof`（源/目标身份控制权证明）和权限枚举；任务 5 定义 `DomainEvent`（id、kind、aggregateId、versionId、payload）、`JobLease`（jobId、owner、leaseToken、expiresAt）和 `Limits`；任务 6 定义上传/扫描 DTO；任务 7 定义 `RevisionDiff`/`WikiLinkDto`；任务 8 定义 `DocumentAst`/`ValidationResult`，任务 9 定义原生编辑器模型。业务 DTO 的完整字段由所属任务实现时在 contracts 同步定义和验证，不用松散对象或未定义全局类型跨任务传递。

每个任务下的测试片段是需要实现的行为断言，使用该任务定义的 fixture；不是已存在的可运行测试。每次只提交本任务文件；先检查暂存区，不顺带提交其他工作。

## 阶段一：能力验证与基础

### Task 1：交付关键能力验证报告与锁定工具链

**Files:** 新建 `package.json`、`package-lock.json`、`tsconfig.base.json`、`probes/editor/roundtrip.test.ts`、`probes/mini-editor/project.config.json`、`scripts/verify-capabilities.mjs`、`docs/decisions/capabilities.json`、`docs/evidence/platform-validation.md`。
**Interfaces:** 输出 `CapabilityResult { capability: string; status: 'pass'|'blocked'; evidence: string; constraint: string|null }[]`；不提供生产绕过开关。

- [ ] 初始化新代码根、独立 Git 仓库、npm 工作区与 strict 测试环境；在 `probes/editor/roundtrip.test.ts` 定义验证用的 `normalizeAst()` 与编辑器适配 fixture（任务8再抽成生产规范），包含标题、图片、GFM 表格、代码、公式、双链和恶意 HTML。断言 `expect(normalizeAst(after)).toEqual(normalizeAst(before))`，不支持结构必须返回明确错误。
- [ ] 运行 `npm run verify:capabilities -- --local`，确认未接适配器的用例失败，再以 Milkdown 为首个 Markdown 编辑器候选验证；若不能通过，再以 Tiptap 候选验证，不用库名替代结果。小程序原型验证原生输入、选区、源码切换和同一 fixture，网站通过不代表小程序通过。
- [ ] 读取实际可用工具/schema 和官方文档，核验微信云托管两服务、MySQL 版本/全文/备份、对象存储、认证匿名升级/四渠道/双端绑定、文件与文字图片检查接口；只读盘点，真实密钥不写入报告。需平台管理时先按对应技能检查 MCP，不用旧脚本绕过工具边界。
- [ ] 将每项证据、可复现步骤、稳定依赖精确版本和费用构成记入报告；`npm run verify:capabilities -- --report` 验证无缺失条目。真实认证需要可用配置，未验证标 blocked；阻塞能力必须形成具体替代方案，不伪造 pass 或静默删功能。
- [ ] 检查暂存区只含新代码和脱敏文档后，先运行 `git add package.json package-lock.json tsconfig.base.json probes scripts/verify-capabilities.mjs docs`，再单独运行 `git commit -m "chore: validate runtime auth and markdown capabilities"`。

### Task 2：真实 MySQL、API 健康检查和共享契约

**Files:** 新建 `packages/contracts/src/{identity,wiki,common,index}.ts`、`apps/api/src/{main,app.module}.ts`、`apps/api/src/database/{database.module,database.types,migrate}.ts`、`apps/api/src/modules/audit/audit.service.ts`、`apps/api/src/database/migrations/001_core.ts`、`apps/api/test/{support/test-app,core.int.test}.ts`、`scripts/test-database.mjs`。
**Interfaces:** `createTestApp(): Promise<TestApp>`，`TestApp` 字段为 `app:INestApplication`、`db:Kysely<Database>`、`fixtures:TestFixtures`、`close():Promise<void>`；`fixtures.member()/guest()` 返回 `Promise<Actor>`，`fixtures.community()` 由任务4补齐为 `Promise<CommunityDto>`。基础审计提供 `AuditService.append(tx:Transaction<Database>,event:AuditEvent):Promise<void>`。`GET /api/v1/health` 提供存活状态；`GET /api/v1/ready` 验证关键依赖，不输出凭据。

- [ ] 写失败测试：空 MySQL 测试库迁移后能插入用户，事务抛错则业务记录不提交；公共契约拒绝额外角色提升字段；健康检查不含连接字符串。
- [ ] 运行 `npm run test:api -- test/core.int.test.ts` 确认失败；实现连接池、Kysely 类型、用户/身份/基础审计表、时区和 utf8mb4。社区表由任务4拥有；迁移记录版本并串行执行，禁止自动 reset 数据库。
- [ ] 建立隔离 MySQL 测试启动/连接流程。若本机 Docker 不可用，使用明确的可丢弃测试实例并校验库名和环境标记；不以 SQLite/PostgreSQL 替代 MySQL 事务/全文验收，不把测试连接指向线上。
- [ ] 运行 `npm run db:migrate:test`、`npm run test:contracts`、上述集成测试及 `npm run check`；迁移第二次执行不重复建表、错误迁移阻止后续发布。
- [ ] 提交本任务：`git commit -m "feat: add mysql foundation and typed api contracts"`，只暂存上述新增/修改文件。

### Task 3：统一认证、游客升级与权限边界

**Files:** 新建 `apps/api/src/modules/identity/{identity.service,auth-provider,password-auth.service,auth.controller,auth.guard,permissions.service,personal-records.service}.ts` 及微信/验证码适配器、`apps/api/src/database/migrations/002_identity.ts`、`apps/api/test/identity.int.test.ts`。迁移在本任务创建可按业务键存储的收藏/草稿/浏览记录表，供游客升级真实测试；任务10只扩展和复用，不重复建表。
**Interfaces:** `AuthProvider.verify(token:string):Promise<VerifiedIdentity>`；`IdentityService.resolve(identity:VerifiedIdentity):Promise<Actor>`；`upgradeGuest(ctx:RequestContext, proof:LinkProof):Promise<Actor>`；`PermissionsService.requireMember(ctx):Actor`、`requireCommunity(ctx,communityId,permission):Promise<void>`。

- [ ] 写失败断言：`guest POST /posts => 403`；过期/伪造 token =>401；升级后原收藏/草稿属于同一业务账号；仅昵称相同不合并；并发绑定同一外部身份只能归一个业务用户；跨社区管理 =>403。
- [ ] 运行 `npm run test:api -- test/identity.int.test.ts` 确认失败，再实现已通过任务 1 的认证适配器、唯一身份映射、服务端权限与审计。测试身份提供者只在测试依赖注入中存在，生产启动缺真实配置应失败。
- [ ] 对“已有正式账号 + 游客数据”采用受证明的账号绑定/合并事务，草稿和收藏去重；不能用客户端声称的 userId/kind 提权。管理员初始授权通过受控配置/一次性初始化操作，不开放公开注册管理员。
- [ ] 重跑身份集成及契约测试；用受控测试账号验证四种真实路径、游客升级、撤销登录与双端同号，未验证路径明确阻塞发布。
- [ ] 提交：`git commit -m "feat: implement unified identity guest upgrade and scoped permissions"`。

### Task 4：社区生命周期与双端基础入口

**Files:** 新建 `apps/api/src/modules/communities/{communities.service,communities.controller}.ts`、迁移 `003_communities.ts`、`apps/web/src/app/{layout,page}.tsx`、`apps/web/src/app/admin/layout.tsx`、`apps/web/src/components/{AppShell,AuthDialog}.tsx`、`apps/miniprogram/src/{app.ts,app.json,services/api.ts,pages/home/index.*}`、测试 `communities.int.test.ts`、`tests/web/access.spec.ts`。
**Interfaces:** `listCommunities(ctx):Promise<CommunityDto[]>`；`applyCommunity(ctx,input)`、`approveApplication(ctx,id)`、`inviteModerator(ctx,communityId,userId)`、`acceptInvite(ctx,inviteId)`；批准事务同时创建 Wiki 空间（`wiki_spaces` 表在本任务迁移创建，任务7扩展词条/修订）。两端 API 客户端统一处理 `ApiProblem`。

- [ ] 写失败测试：初始化固定六社区且重复运行不重复；游客能读；批准后创建社区/负责人/Wiki，受邀人接受后才有版主权限；普通版主不能改平台角色或默认入口。
- [ ] 运行 `npm run test:api -- test/communities.int.test.ts` 与 `npm run e2e:web -- access.spec.ts` 确认失败；实现上述 API、幂等种子与真实数据首页骨架、公开访问和登录入口。
- [ ] 建立小程序配置/构建，公开配置只含环境 ID、服务名等非秘密；网站管理区校验服务端权限，不以路由路径保护 API。UI 使用现有 Demo 的结构与色彩方向，人数从真实数据计算，不保留假热度。
- [ ] 重跑测试、`npm run test:mini` 和双端构建；未登录访问内容不被登录弹窗拦截，游客能存草稿但不可提交。
- [ ] 提交：`git commit -m "feat: add community lifecycle and public client shells"`。

### Task 5：可恢复任务、审计和配置

**Files:** 新建 `apps/api/src/modules/jobs/{jobs.service,jobs.runner,outbox.service}.ts`、`modules/settings/settings.service.ts`、迁移 `004_jobs_audit.ts`、`test/jobs.int.test.ts`；扩展任务2已有的 `modules/audit/audit.service.ts`，不重复创建基础审计表。
**Interfaces:** `recordEvent(tx:Transaction<Database>,event:DomainEvent):Promise<void>`；`JobsService.enqueue(tx,input):Promise<string>`；`claim(workerId,now):Promise<JobLease|null>`、`complete(lease)`、`retry(lease,errorCode)`；`AuditService.append(tx,event)`、`SettingsService.getLimits():Promise<Limits>`。

- [ ] 写失败测试：两个 runner 只领取一次有效租约；崩溃到期可再领取；旧租约不能确认新租约；同业务幂等键不生成重复通知；事务回滚也回滚事件。
- [ ] 运行 `npm run test:api -- test/jobs.int.test.ts` 确认失败；实现 MySQL 任务、租约、重试退避、死信和 API 内 runner，领取/执行/外部调用不占长事务。
- [ ] 事件关联业务对象与版本；记录可恢复错误，不保存密码、验证码或明文 token。进程优雅退出停止领新任务，不把 timer 状态当唯一任务记录。
- [ ] 重跑并发/崩溃测试；确认 runner 重启可继续处理，后台能查询积压、失败及下次重试。
- [ ] 提交：`git commit -m "feat: add durable jobs outbox audit and limits"`。

## 阶段二：资源与 Wiki

### Task 6：真实上传、检查与下载授权

**Files:** 新建 `modules/media/{media.service,storage.adapter,scanner.adapter,upload-limits.service}.ts`、`modules/resources/resources.service.ts`、迁移 `005_media_resources.ts`、`packages/contracts/src/media.ts`、`test/media.int.test.ts`。
**Interfaces:** `reserveUpload(ctx,{sizeBytes,mime,filename,key}):Promise<UploadGrant>`；`completeUpload(ctx,uploadId):Promise<MediaDto>`；`getDownload(ctx,mediaId):Promise<DownloadGrant>`；`ScanResult { state:'clean'|'review'|'rejected'|'unavailable'; mediaVersion:string }`。

- [ ] 写失败断言：100_000_001 字节拒绝；并发两次额度合计不能超过200_000_000；同一次确认不重复扣额；Asia/Shanghai跨日正确；伪造大小/文件类型拒绝；pending/rejected文件下载=>403；过期上传预留可回收。
- [ ] 运行 `npm run test:api -- test/media.int.test.ts` 确认失败；实现签名直传、服务端确认实际元数据、扫描状态、只读短期下载凭据与资源外链。检查接口不可用转待审，不作成功处理。
- [ ] 使用任务 5 运行扫描与过期预留清理；ZIP/常用文档按任务1验证的能力处理，不能把文本安全 API 当病毒扫描器。嵌套压缩和解压体积设工程限制并记录，阻止无界解压。
- [ ] 重跑测试并在测试存储做一次真实上传/检查/下载/过期验证；文件不依赖容器磁盘，后台额度修改生效。
- [ ] 提交：`git commit -m "feat: add quota controlled storage and resource publishing"`。

### Task 7：Wiki 修订、冲突、回滚与引用事务

**Files:** 新建 `modules/wiki/{wiki.service,wiki.controller,wiki-links.service,wiki-diff.service}.ts`、迁移 `006_wiki.ts`、`packages/contracts/src/wiki.ts`、`test/wiki-revisions.int.test.ts`。
**Interfaces:** `saveRevision(ctx,pageId,input:SaveRevisionInput):Promise<WikiRevisionDto>`；`rollback(ctx,pageId,{targetRevisionId,baseRevisionId,idempotencyKey}):Promise<WikiRevisionDto>`；`getRevisionDiff(ctx,fromId,toId):Promise<RevisionDiff>`；`listBacklinks(ctx,pageId):Promise<WikiLinkDto[]>`。

- [ ] 写失败测试：同社区同标识唯一、不同社区同名独立；并发同基础版本仅一次成功，另一返回409及最新版本引用；相同幂等键重试只创建一个版本，不同内容复用键拒绝；回滚创建新版本且旧版不变。
- [ ] 运行 `npm run test:api -- test/wiki-revisions.int.test.ts` 确认失败；实现当前版本 CAS 更新与不可变修订同事务提交，权限和保护状态由服务端检查，普通正式用户修订立即公开。
- [ ] 在同一事务记录引用变化与更新事件；跨社区引用包含明确社区上下文，不共享正文。隐藏版本正文、附件不可用、改名/归档均保留可解释的历史引用；差异返回文本块与附件变化。
- [ ] 重跑测试，追加“不加入社区也可普通编辑、版主保护后拒绝普通编辑、旧base回滚409、回滚后反向引用更新”的用例并通过。
- [ ] 提交：`git commit -m "feat: implement versioned community wikis with conflict protection"`。

### Task 8：网站 Markdown 规范与 Wiki 完整界面

**Files:** 新建 `packages/markdown/src/{schema,parse,serialize,render,links}.ts`、`packages/markdown/test/roundtrip.test.ts`、`apps/web/src/components/wiki/{WikiEditor,WikiArticle,RevisionDiff,ConflictResolver}.tsx`、`apps/web/src/app/c/[slug]/wiki/[[...path]]/page.tsx`、`tests/web/wiki.spec.ts`。
**Interfaces:** `parseMarkdown(source):DocumentAst`、`serializeMarkdown(ast):string`、`validateDocument(ast):ValidationResult`；`WikiEditor({value,onChange,onUnsupported})`；调用任务7 API，不另存第二份权威正文。

- [ ] 写失败断言：标题/图片/表格/代码/公式/双链往返语义一致；脚本、事件属性和javascript URL无法执行；不支持的粘贴/结构切换有明确提示并保留原稿；冲突后本人修改仍可复制/合并。
- [ ] 运行 `npm run test:markdown`、`npm run e2e:web -- wiki.spec.ts` 确认失败；使用任务1通过的编辑器实现阅读、分类、新建、编辑、源码切换、历史、逐段差异、回滚和反向链接。
- [ ] 图片插入复用任务6授权流程；公式/代码使用已验证的渲染器，危险 HTML 不直接输出。冲突合并携带最新基础版本重试，不以“强制保存”跳过服务器 CAS。
- [ ] 重跑 Markdown 与浏览器测试；用中文长标题、数学单字、长代码、手机窄屏和键盘操作检查，截图只证明 UI，不代替事务测试。
- [ ] 提交：`git commit -m "feat: build markdown wiki reading editing and revision ui"`。

### Task 9：原生小程序 Wiki 与内容一致性

**Files:** 新建 `apps/miniprogram/src/pages/wiki-{list,article,edit,history,diff}/index.*`、`components/wiki-editor/index.*`、`services/wiki.ts`、`test/wiki-codec.test.ts`、`tests/mini/wiki.e2e.mjs`、`scripts/run-mini-e2e.mjs`。
**Interfaces:** 使用任务7 DTO与任务8规范；适配层 `nativeDocumentToAst(value):DocumentAst`、`astToNativeDocument(ast):NativeDocument`；草稿包含社区、词条与baseRevisionId。

- [ ] 写失败测试：与网站相同fixture往返后语义一致；切模式/离开页面不丢草稿；并发冲突保留本地修改；登录失效不把未提交正文标成成功。
- [ ] 运行 `npm run test:mini -- test/wiki-codec.test.ts` 确认失败；实现原生可视化/源码编辑、图片、表格、公式、代码与链接适配，连接真实 Wiki API。
- [ ] 编写并运行 `npm run e2e:mini -- wiki.e2e.mjs`：开发者工具中完成浏览→编辑→冲突→合并→历史→回滚；再真机核验输入法、长文、文件与公式显示。
- [ ] 无开发者工具登录/真机条件时，单元测试可以通过，但该项验收保持未完成；能力不满足必须带具体失败样例提出方案，不改为“仅跳网站”。
- [ ] 提交：`git commit -m "feat: add native mini program wiki authoring and history"`。

## 阶段三：社区业务与治理

### Task 10：类型化内容、评论、反馈与匿名输出

**Files:** 新建 `modules/content/{posts.service,comments.service,votes.service,collections.service,public-presenter,anonymous-identity.service}.ts`、迁移 `007_content.ts`、`packages/contracts/src/content.ts`、`test/content-privacy.int.test.ts`。
**Interfaces:** `publishPost(ctx,input:PublishPostInput):Promise<PostDto>`；`createComment(ctx,postId,input)`；`presentPost(ctx,record):PostDto`；`getAnonymousAccount(ctx,postId,reason):Promise<RestrictedAccountDto>`；`setVote(ctx,target,value:-1|0|1)`。

- [ ] 写失败断言：游客写入403；默认普通/固定树洞/每帖随机署名符合选择；评论回复、文件、错误及DTO都不泄露匿名作者userId/普通主页；版主查关联403，指定平台权限且有理由才200并留审计。
- [ ] 运行 `npm run test:api -- test/content-privacy.int.test.ts` 确认失败；实现各类帖子共用生命周期、公开呈现器、评论回复、收藏/记录/草稿和每账号唯一当前投票。
- [ ] 联系方式由作者显式选择展示，树洞不自动附普通个人卡片；限制账号仍按后台真实用户生效，不因随机昵称绕过。编辑创建待检版本，不立即替换已通过的公开版本。
- [ ] 重跑测试，并验证单个用户不能操作他人草稿、评论或联系方式；重复投票/取消反馈正确，所有公开输出经过统一呈现器。
- [ ] 提交：`git commit -m "feat: add community content interactions and anonymous identity boundaries"`。

### Task 11：问答采纳与交易/失物完成状态

**Files:** 新建 `modules/questions/questions.service.ts`、`modules/market/market.service.ts`、迁移 `008_questions_market.ts`、`test/questions-market.int.test.ts`。
**Interfaces:** `acceptAnswer(ctx,questionId,answerId):Promise<QuestionDto>`；`completeListing(ctx,postId,expectedState):Promise<PostDto>`；`proposeWikiFromAnswer(ctx,answerId):Promise<WikiDraftDto>`，最后一个只产生草稿。

- [ ] 写失败测试：仅提问者/授权管理员可采纳；不能采纳其他问题的回答；交易/失物只有作者或授权治理者能完成；重复完成幂等；好答案不能未经编辑直接发布 Wiki。
- [ ] 运行 `npm run test:api -- test/questions-market.int.test.ts` 确认失败，实现价格/成色/交付方式、求购、寻物/招领、已出/找回/归还等类型化字段与状态检查。
- [ ] 重跑测试；验证匿名呈现和权限复用任务10，不另加订单、支付或私信；状态变化记录事件并刷新公开视图。
- [ ] 为管理员纠正错误状态补权限/审计用例，通过后提交：`git commit -m "feat: add accepted answers and marketplace resolution states"`。

### Task 12：活动与搭子报名事务

**Files:** 新建 `modules/activities/activities.service.ts`、迁移 `009_activities.ts`、`test/activities.int.test.ts`。
**Interfaces:** `register(ctx,activityId,key):Promise<RegistrationDto>`、`cancelRegistration(ctx,id,key)`、`changeActivity(ctx,id,input:ActivityChangeInput):Promise<ActivityDto>`。

- [ ] 写失败测试：同一账号并发报名只占一个名额；最后一个名额同时请求不超卖；截止/取消/结束后不可报名；重复取消不让余量增加两次。
- [ ] 运行 `npm run test:api -- test/activities.int.test.ts` 确认失败；实现活动行锁/条件更新、唯一报名记录、时间地点及容量/截止状态，变更可靠记录通知事件。
- [ ] 重跑20个并发报名及取消测试；活动时间按UTC存储并正确显示时区，不将日期字符串直接按执行主机时区解释。
- [ ] 提交：`git commit -m "feat: add capacity safe activity registration and lifecycle"`。

### Task 13：审核、举报和管理后台闭环

**Files:** 新建 `modules/moderation/{moderation.service,checks.adapter,reports.service}.ts`、迁移 `010_moderation.ts`、`apps/web/src/app/admin/{applications,queue,reports,users,wiki,jobs,settings,audit}/page.tsx`、`test/moderation.int.test.ts`、`tests/web/admin.spec.ts`。
**Interfaces:** `applyCheckResult({objectId,versionId,result}):Promise<void>`；`review(ctx,itemId,decision,reason)`；`restrictAccount(ctx,scope,input)`；`protectWiki(ctx,pageId,input)`，均返回当前状态并记审计。

- [ ] 写失败测试：v1检查结果晚于v2编辑不能公开旧正文；已下架内容不能被迟到回调重新公开；重复回调幂等；检查故障转待审；版主不能管理其他社区或读取匿名关联。
- [ ] 运行 `npm run test:api -- test/moderation.int.test.ts` 与 `npm run e2e:web -- admin.spec.ts` 确认失败；实现任务检查适配器和版本化状态机，将申请、审核、举报、Wiki保护、封禁/解除、文件状态和失败任务接入真实后台。
- [ ] 管理动作要求理由并形成审计；任务重试不删除失败证据；Wiki普通编辑不进入常规先审队列。没有真实检查能力时保持待审，不写生产永远返回clean的适配器。
- [ ] 重跑测试，人工走完发布→疑似→审核、举报→下架、词条保护→解除与社区申请→批准→邀请。
- [ ] 提交：`git commit -m "feat: connect moderation reports and scoped admin operations"`。

### Task 14：混合信息流、MySQL 搜索与站内通知

**Files:** 新建 `modules/feed/feed.service.ts`、`modules/search/{search.service,search-indexer}.ts`、`modules/notifications/notifications.service.ts`、迁移 `011_feed_search.ts`、`test/search-feed.int.test.ts`。
**Interfaces:** `getFeed(ctx,{scope:'all'|'joined',sort:'new'|'hot',cursor}):Promise<CursorPage<FeedItemDto>>`；`search(ctx,{query,communityId?,kind?,cursor}):Promise<CursorPage<SearchHitDto>>`；`listNotifications(ctx,cursor)`、`markRead(ctx,ids)`。

- [ ] 写失败断言：中文/英语/混合查询、单字“熵”标题、同名跨社区词条不串结果；已隐藏/待审正文不命中；搜索、通知及引用不泄露匿名作者；同一词条连续修订聚合为更新摘要但历史完整。
- [ ] 运行 `npm run test:api -- test/search-feed.int.test.ts` 确认失败；迁移建立经任务1验证的全文索引，组合标题/别名/标签回退和权限过滤；站内通知只面向有权接收的账号。
- [ ] 采用固定且有测试的热度公式，例如 `(up-down)/(ageHours+2)^1.5`，相同分数以时间和ID稳定排序；分页不能重复/漏掉固定快照内项目。更新索引消费版本事件，旧事件不覆盖新版或撤销下架。
- [ ] 重跑测试，重建索引后结果一致；API返回真实内容，不复制静态Demo数据，不新增搜索服务或私信功能。
- [ ] 提交：`git commit -m "feat: add unified search mixed feeds and business notifications"`。

## 阶段四：双端完成与上线

### Task 15：网站业务 UI、游客升级和个人记录

**Files:** 新建/完善 `apps/web/src/app/{c/[slug],p/[id],publish,search,me,notifications}/page.tsx`、`components/content/{Composer,PostCard,Comments,ContactCard}.tsx`、`tests/web/{community,guest-upgrade,resources,activities}.spec.ts`。
**Interfaces:** 仅消费已定义API/DTO；上传走任务6，Wiki走任务8，角色由任务3解析，客户端不实现另一套权限判定真源。

- [ ] 写失败浏览器测试：游客收藏/草稿→注册升级仍在；投稿需正式账号；社区申请/加入、四类发布、问答采纳、交易/失物完成、报名取消、通知已读分别完成真实状态变化。
- [ ] 运行 `npm run e2e:web -- community.spec.ts guest-upgrade.spec.ts resources.spec.ts activities.spec.ts` 确认失败；实现所有入口、审核等待/拒绝/重试、空状态和网络错误，沿用Demo已暂定视觉方向而非旧UI。
- [ ] 在320/390/768/1440宽度核验导航、可访问名称、键盘焦点、Markdown表格/代码和长标题；刷新/后退保留上下文，不把失败显示为已发布。游客从收藏进入草稿、登录升级后再次打开均保留内容；后台完整流程除任务13外追加资源状态、用户角色、限额设置、审计和失败任务重试的实测。
- [ ] 重跑浏览器与 `npm run test:web`、构建；截图对比关键页，确认管理页面和普通浏览互不串权限。
- [ ] 提交：`git commit -m "feat: complete responsive web community and personal flows"`。

### Task 16：小程序社区业务与真机验收

**Files:** 新建/完善 `apps/miniprogram/src/pages/{community,post,publish,resource,activity,me,notifications,login}/index.*`、`services/{identity,content,media}.ts`、`tests/mini/community.e2e.mjs`。
**Interfaces:** 消费相同API协议；小程序调用云托管与网站公开访问的身份传递不同，但最终均解析为任务3的业务Actor，不直接信任客户端传来的微信标识。

- [ ] 写失败用例：游客不越权；登录/绑定升级不丢数据；100MB额度边界与上传取消可恢复；重复点击报名不重复占位；匿名页面和系统分享不带真实作者信息。
- [ ] 运行 `npm run test:mini` 确认失败；实现社区、类型化发布、资源上传下载、留言、活动、记录与通知，复用任务9的Wiki页面。
- [ ] 运行 `npm run e2e:mini -- community.e2e.mjs`，开发者工具与真机分别验证登录、文件授权、弱网重试、后台切回及长文输入；微信审核/账号能力由实际测试证据确认，不靠浏览器仿真替代。
- [ ] 双端同时操作同一社区/词条/活动，核验状态一致；未跑的真机能力列为未完成。
- [ ] 提交：`git commit -m "feat: complete native mini program community workflows"`。

### Task 17：两服务构建、私有仓库流水线与邮件告警

**Files:** 新建 `deploy/{web,api}/Dockerfile`、`deploy/cloudhosting/services.example.json`、`.github/workflows/{ci,release-web,release-api}.yml`、`scripts/{release,smoke,monitor}.mjs`、`docs/operations/{deploy,alerts,recovery}.md`、`test/operations.int.test.ts`。
**Interfaces:** `release({target:'web'|'api',imageDigest,environment}):Promise<ReleaseResult>`；`probe(target):Promise<HealthSample>`；`notifyEmail({incidentKey,state,summary}):Promise<void>`；示例配置显式填写完整EnvId，真实值通过平台安全配置注入。

- [ ] 写失败断言：缺少环境/凭据拒绝发布；web发布不替换API；无已通过构建证据不能发布；连续约5分钟故障只发一次告警，恢复后发恢复通知；日志不含token、验证码或匿名关联。
- [ ] 运行 `npm run test:api -- test/operations.int.test.ts` 确认失败；实现两个不可变镜像、健康检查、优雅退出、明确的后台任务生命周期和手动触发发布工作流。MySQL迁移作为独立串行步骤，不由每个容器启动自动执行。
- [ ] 新代码通过秘密扫描后，通过可用GitHub连接器/CLI建立用户选定所有者下的私有仓库；上传范围仅R。无可用账户/仓库所有者信息时请求必要输入，不改建公共仓库。实际仓库标识与云服务配置写入脱敏发布记录。
- [ ] 依据实际云托管配置验证网站/API各至少1实例、测试可休眠、资源与计费上限、积压/容量/费用80%告警。外部探活使用独立于被监控API的可用监控/定时执行能力；不能由已经停掉的API给自己告警。按实际调度延迟验证约5分钟阈值，不把无保障的定时配置当准点承诺。邮件仅发至用户明确配置的收件人，不接IM机器人。核验平台原生备份与恢复路径，不搭回暂缓的双地区方案。
- [ ] 在测试环境验证镜像发布、启动失败回退、邮件告警与计时恢复；再跑 `npm run check` 和任务测试，通过后提交：`git commit -m "ops: add independent cloud hosting releases and email monitoring"`。

### Task 18：完整验收、预算核算与直接替换旧系统

**Files:** 新建 `scripts/{acceptance,load-test,cutover}.mjs`、`docs/evidence/{acceptance,capacity,budget,release-manifest}.md`、`docs/operations/cutover.md`；修改正式环境的非秘密发布配置和小程序API配置。
**Interfaces:** `acceptance({environment}):Promise<AcceptanceReport>`；`cutover({approvedManifestPath}):Promise<CutoverResult>`。manifest列明目标服务/域名/小程序版本、数据库业务库边界、镜像digest、费用和测试结果，不包含密钥。

- [ ] 写切换演练用例：清单外服务/数据库操作被拒绝；缺必要验收/生产确认不能切换；不导入旧业务数据；不能DROP整个共享MySQL实例。记录旧镜像/路由信息用于应用层回退，不新增用户已取消的旧数据备份前置要求。
- [ ] 运行 `npm run check`、全部MySQL集成、Markdown、网站端到端、小程序构建与原生端到端；将实际真机及四渠道认证结果写入验收报告。任何假身份/模拟扫描仅属测试，不能充当上线证据。
- [ ] 加载1000账号、200日活的合成场景，20虚拟用户持续15分钟，混合浏览/搜索/编辑/报名；要求无意外5xx、无超卖/丢版本/越权，记录吞吐、p50/p95、资源、连接数与任务延迟。容量结果必须对应实际版本和规格，不凭账号数宣称够用。
- [ ] 按真实云托管报价/用量重算两常驻服务、MySQL、文件50GB/下载100GB、认证/检查/邮件等费用；分别列300目标与500以内可选调整。列出RPO1h、发现后RTO4h及恢复演练实际证据或差距，备份保留期仍需据可用能力/成本确认，不在报告伪装已达标。
- [ ] 先给用户可审阅的release-manifest、明确替换目标与验收结果，由用户确认生产发布后执行直接替换：不迁移旧数据、不要求并行；使用明确的新业务库/存储边界，不误删无关资源。收费资源购买、资质或必填配置欠缺时保留具体阻塞项，完成其他准备，不擅自切换。
- [ ] 对网站、API、小程序正式入口做匿名浏览、正式/游客权限、Wiki保存/回滚、资源下载和后台检查；更新发布记录并提交：`git commit -m "release: record verified umeet replacement"`。完成标准是发布后实测，不是CI变绿或镜像上传成功。

## 实施门槛与信息需求

只有实际任务需要时才获取：可用微信云托管环境与权限、MySQL/存储的测试与正式连接、微信网站/小程序应用配置、邮件/短信/检查能力、GitHub仓库所有者、告警收件人。优先查已有连接和可读配置，不让用户重复提供可查事实；秘密只进入安全配置。

以下必须带验证结果再决定：最终MySQL版本、认证适配方式、原生编辑器能力、文件检查覆盖、正式服务规格和发布目标。若能力不足，不直接改变已确认功能，而是给出具体失败用例、替代方案和影响。不能为了赶进度把整个完整首版缩成只读站。

## 自检与覆盖索引

| 设计范围 | 任务 |
| --- | --- |
| 六默认社区/申请/负责人/版主 | 3、4、13 |
| 四登录/游客/升级/权限 | 1、3、4、15、16 |
| 独立Wiki/Markdown/引用/历史/冲突/回滚 | 1、7、8、9 |
| 资源文件/额度/检查/下载 | 1、6、13、15、16 |
| 日常/树洞/评论/投票/收藏/记录 | 10、15、16 |
| 问答/交易/失物/搭子活动 | 11、12、15、16 |
| 统一搜索/混合信息流/站内通知 | 5、14、15、16 |
| 审核/匿名身份/后台管理 | 3、5、10、13、14 |
| 两服务/CI/人工发布/告警/恢复目标 | 1、17、18 |
| 不迁移旧数据/直接替换/不波及共享资源 | 18 |

计划完成后由编写者自己检查：所有契约名字/DTO/命令前后一致；每个Review Focus有具体测试；没有无任务覆盖的设计要求；所有阶段是同一首版的实现顺序而非删减；待核实的事实都有明确验证步骤而非空白决定；当前不执行任务1或任何部署。

2026-11-07 自检结果：已逐项检查设计1—14节并对照以上覆盖索引。修正了游客数据在后续内容模块之前缺少表、社区批准早于Wiki表创建、审计服务依赖顺序、路径缩写和独立外部探活等问题；五类Review Focus均已落到对应测试。未运行未来产品测试，不把文档自检称为代码验证通过。

## 执行交接

请用户审阅计划并选择执行方式：原生逐项执行，或逐任务子代理实施与独立审阅。个人维护且任务接口依赖紧密，默认建议原生执行，最后进行一次独立整体审阅；如果优先逐步独立复核，可选子代理方式。

本机已检索常用技能目录，尚未找到头部引用的 `executing-plans` / `subagent-driven-development` 配套技能。它们属于进入实施时的工具准备项，不影响当前计划交付；开始实施前需查找/补齐对应技能，不应谎称已加载。写计划的自检由本会话完成，不另派计划审阅子代理。
