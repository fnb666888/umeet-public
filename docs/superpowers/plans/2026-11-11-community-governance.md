# 社区管理与申请流程实施计划

## 实施记录　2026-11-11

追加单版主与助手申请调整已实现。群组和申请写入事务检查同一板块唯一版主，板块入口依据当前版主切换申请类型，社区工作台由版主选择团队及权限批准助手，全站后台继续审批开板与版主。全量测试现为 152 项通过，助手申请到批准入队的浏览器流程、类型检查及两端构建通过。本地现有版主范围无重复，临时验收数据已清理。

八阶段的业务代码已接通。下方原始清单同时包含测试组织方式与建议文件名，实际采用 `community-governance.int.test.ts`、`board-directory.int.test.ts` 集中覆盖，因此保留原清单作为计划基线，验收以本节为准。

| 阶段 | 已交付 |
| --- | --- |
| 1 | 动态板块目录、新板块普通讨论、旧六板块映射、设置与授权支持扩展标识 |
| 2 | 逐人逐板块版主授权、助手身份、账号层级保护、权限上限与收权联动 |
| 3 | 用户主页主动管理入口、工作台受限用户列表、带范围的用户详情及返回主页 |
| 4 | 团队创建、逐人邀请与授权、接受、退出审批、暂停与管理员转交、通知与记录 |
| 5 | 共用资格策略、实时审批复查、申请状态机、独立开板及版主任命、重复请求保护 |
| 6 | 用户申请、我的申请与团队邀请、后台审核、版主意见、申请人资格及处置历史 |
| 7 | 板块简介与规则维护、版本冲突、保存反馈及离开提示 |
| 8 | 本地备份、029／030／031 迁移、自动回归、构建与浏览器验收、临时数据清理 |

验证记录如下。

- `npm run typecheck` 通过。
- `npm test` 最近一次完整运行 45 个文件、151 项测试通过。新增断言覆盖邀请重试、重复批准、离任转交、受限暂停恢复、收权永久裁剪，以及警告不阻止资格和授权。
- `npm run build:api` 和 `npm run build:web` 通过。
- `python tests/web/community-governance.py` 已走通申请、分别审批、创建团队、邀请接受、退出审批和板块规则保存。1440、871、390 像素及明暗主题保存截图。测试自动创建独立会话并清理临时用户、板块、团队与申请。
- `python tests/web/dispositions.py` 已通过组合处置、永久社区限制、部分撤销申诉、停用账号和安全操作回归。
- 早期一次全量运行遇到本地数据库连接超时，重跑相关测试及后续全量运行通过。

实现差异和边界如下。

- 现有旧 `CommunitiesService` 生命周期方法继续保留兼容，其接口未暴露申请或任命写入路由。新页面全部使用 `community-governance` 流程和统一管理授权。
- 申请与团队变更采用版本加请求内容哈希保证重复提交不产生重复记录，并沿用现有内容全局事务锁串行处理授权变更。
- 板块标识支持最多 80 字符，对旧处置表的板块字段补充扩容迁移。
- 自定义日期、板块改名、关闭和删除继续属于原有或后续专门设计范围。本次交付集中于已批准的治理流程。
- 当前工作区包含此前多轮交织的未提交修改，本次以工作区交付，尚未创建 Git 提交。

按任务在当前会话顺序实施，每项完成后验证，再进入下一项。执行方式建议为当前主代理实施，执行前由用户核对本文及需求稿。

## 目标与架构

实现用户主页主动处置、单板块管理团队及逐人授权、开板与版主申请完整流程。沿用 NestJS、Kysely、MySQL、Zod、Next.js 和 React，统一授权入口，扩展动态板块目录。

需求依据见 `../specs/2026-11-11-community-governance-design.md`。所有代码路径相对于 `rebuild/`，命令在该目录运行。

## 全局约束

- 初始资格为注册满 30 天、全站未删除帖子至少 5 篇，两项均满足。任何生效中的限制阻止加入或审批。
- 每团队一个板块，权限逐人配置。创建者与全站管理员可修改，其他同板块版主只读。
- 助手无申诉复核与团队授权权限，只能处置普通用户。版主可以处置助手，原全站身份保护继续执行。
- 申请独立详情、紧凑表格、搜索直接显示、窄屏可操作，保留返回列表与浏览器返回路径。
- 现有六个板块标识、历史授权、处置记录和限制保留。
- 代码变更前记录当前工作区基线。当前工作区包含多轮未提交改动，提交时必须能独立分离本次修改，无法分离时保留工作区并报告。
- 修改 Next.js 代码前按 `apps/web/AGENTS.md` 阅读安装版本对应指南。

## 风险检查

1. 旧板块目录与新目录标识不一致，发帖、授权、Wiki 和申诉必须指向同一板块。任务 1 验证。
2. 审批、接受邀请与收权并发，不能产生越权授权或重复板块。任务 2、4、5 验证。
3. 创建者离任与助手受限同时发生，解除一个条件不能恢复全部权限。任务 2、4 验证。
4. 一人兼具助手、版主、自定义群组身份时，权限合并和账号保护必须一致。任务 2、3 验证。
5. 资格统计遇到删除／恢复帖子、门槛调整、重复提交，审批按实时数据判断且不影响已任职人员。任务 5 验证。

## 任务 1　统一可扩展板块目录

涉及 `packages/contracts/src/community.ts`、`site-settings.ts`、`admin.ts`，`apps/api/src/modules/communities/communities.service.ts`、`communities.controller.ts`，`modules/admin/scope.ts`，`modules/demo/demo.schema.ts`、`demo-snapshots.service.ts`，`modules/settings/settings.service.ts`，`apps/web/src/components/community/model.ts`、`store.tsx`、`Pages.tsx`、`Composer.tsx`、`Wiki.tsx`。新增目录契约 `packages/contracts/src/boards.ts` 与迁移 `apps/api/src/database/migrations/029_community_governance.ts`，登记于 `database/migrate.ts`，更新 `database.types.ts`。

接口约定采用 `BoardSummary {id, slug, name, description, rules, state}`。公开业务沿用 slug，数据库关联使用 id。新增普通讨论板块，已存在六种专用展示保留。

- [ ] 在 `apps/api/test/communities.int.test.ts` 和 `packages/contracts/test/community-governance.test.ts` 增加回归，覆盖新标识可用于帖子／Wiki／授权，未知标识服务端拒绝，旧六板块兼容。
- [ ] 运行 `npx vitest run apps/api/test/communities.int.test.ts packages/contracts/test/community-governance.test.ts`，确认新增断言暴露现有固定枚举限制。
- [ ] 建立稳定 slug 与数据库社区映射，替换固定枚举、最多六项限制和运行时固定目录。保留导出的旧默认值供旧数据解析，业务验证按当前目录。搜索仓库全部 DemoBoard、boards、boardCommunities 使用点逐个分类处理。
- [ ] 验证第七板块发帖、回复、关注、搜索、举报、Wiki、回收站与授权，不自动授予现有群组。迁移重复执行不重复创建板块。
- [ ] 运行上述测试及 `npm run typecheck`，通过后记录任务结果。

## 任务 2　逐人逐板块授权与身份层级

涉及 `packages/contracts/src/admin.ts`、`moderation-permissions.ts`，`apps/api/src/modules/admin/scope.ts`、`groups.ts`、`restrictions.ts`、`dispositions.ts`、`governance.service.ts` 与迁移／数据库类型。新增 `modules/admin/community-teams.ts`。

新增权限 `teams.manage`、`boards.edit`，版主标准模板默认包含。成员授权记录保存用户、板块、权限、版本，团队增加类型、创建者、板块和状态。接口 `getEffectiveBoardAccess(db,userId,board)` 返回有效身份、权限和来源，`requireAccountManagement` 同时接收处置板块，以区分版主、助手和普通用户。

- [ ] 在 `apps/api/test/community-teams.int.test.ts` 增加逐人授权、版主可处置助手、助手不可处置助手、版主保护、助手不可创建团队、身份叠加测试。
- [ ] 运行 `npx vitest run apps/api/test/community-teams.int.test.ts apps/api/test/group-management.int.test.ts`，确认新规则需要实现。
- [ ] 增加成员授权与团队记录，旧版主成员按现有板块和权限回填，旧自定义群组行为保留。有效身份由正式授权确定，助手权限不作为可转授权来源。
- [ ] 在统一权限入口实时排除暂停条件，收权时事务内裁剪已有助手权限并记录，恢复创建者权限后不补回被裁剪项。
- [ ] 覆盖并发收权与授权、全站管理员调整团队仍受创建者上限约束、创建者离任暂停与助手受限叠加。
- [ ] 运行上列测试及 `apps/api/test/moderation-dispositions.int.test.ts`，通过后记录结果。

## 任务 3　用户主页主动管理

涉及 `apps/web/src/components/community/Profile.tsx`、`Governance.tsx`、`store.tsx`，`components/admin/AdminDetails.tsx`、`AdminWorkspace.tsx`、`admin-api.ts`，API `modules/admin/admin.service.ts`、`admin.controller.ts`。

复用处置接口和用户详情，主页入口带目标用户 id，选择有 `users.manage` 的板块，服务端按最新授权检查。工作台不新增用户搜索或全体用户列表。

- [ ] 增加用户资料入口权限测试，覆盖普通用户不可见、版主对未举报普通用户主动警告／限制、助手对其他助手被服务端拒绝。
- [ ] 显示「管理用户」，多板块执行前选择范围，复用原因、期限、当前版本和确认表单，返回仍回原主页。
- [ ] 主动处置产生一条可识别来源的主记录，通知与申诉沿用现有流程。
- [ ] 执行 `npx vitest run apps/api/test/moderation-workspaces.int.test.ts apps/api/test/moderation-dispositions.int.test.ts`，浏览器验证主页进入与返回，工作台仍只列受限用户。

## 任务 4　管理团队、邀请与退出

涉及新 `modules/admin/community-teams.ts`、`community-teams.controller.ts`、`packages/contracts/src/community-teams.ts`，`apps/api/src/app.module.ts`，`components/admin/PermissionGroups.tsx`、`AdminWorkspace.tsx`、`admin-api.ts`，新增 `CommunityTeams.tsx`。复用 `admin_notifications`。

接口 `createTeam(actorId,{board,name,requestId})`，`inviteTeamMember(actorId,{teamId,userId,permissions,expectedVersion,requestId})`，`acceptTeamInvitation(userId,{id,expectedVersion,requestId})`，`updateTeamMember(...)`，`requestTeamExit(...)`，`approveTeamExit(...)`，`transferTeam(...)`。列表／详情根据创建者、同板块版主、全站管理员返回可操作能力。资格调用任务 5 的统一策略，编码时先完成策略接口再接通接受邀请。

- [ ] 测试邀请前授权、接受后生效、重复接受幂等、接受前收权需刷新确认、跨板块拒绝、逐人权限隔离、其他版主只读。
- [ ] 使用团队／邀请／成员版本和事务串行处理变更，保存请求幂等键。站内通知同事务插入，重试不重复。
- [ ] 创建者离任保留配置并暂停，全站管理员转交有效版主后按新上限恢复。成员限制解除后仅恢复仍有效授权。
- [ ] 退出申请确认前保留授权，确认后撤销该团队来源，其他来源保留。权限调整立即生效并通知。
- [ ] UI 使用列表与独立详情，默认成员页，邀请弹窗展示可选用户并支持搜索，逐人配置权限，助手个人入口显示邀请／退出进度。
- [ ] 运行 `npx vitest run apps/api/test/community-teams.int.test.ts`。任务 5 接通后验证受限、发帖不足、注册不足的邀请不能接受。

## 任务 5　共用申请资格与审批状态机

新增 `packages/contracts/src/community-applications.ts`、`apps/api/src/modules/communities/application-policy.ts`、`applications.service.ts`、`applications.controller.ts`。修改现有 `communities.service.ts` 审批入口以复用新流程，旧角色授予入口统一到新授权体系。扩展 `site-settings.ts`、`site-settings-defaults.ts`、SettingsService 及站点设置 UI。

接口 `getApplicationEligibility(db,userId,now)` 返回 `eligible,registeredDays,validPosts,requiredDays,requiredPosts,blockReasons`。申请 `kind` 为 board／moderator，状态 pending／returned／approved／rejected／withdrawn，保存版本和审核事件。服务提供 `submitApplication`、`resubmitApplication`、`withdrawApplication`、`reviewApplication`，每次修改包含 `requestId` 和 `expectedVersion`。

- [ ] 在 `apps/api/test/community-applications.int.test.ts` 测试注册恰满 30 天、帖子恰好 5 篇、软删除／恢复、永久与定期限制、退回重提、撤回、同板块重复申请、门槛变更。
- [ ] 实现共用配置，初始 30／5，使用服务端时间。通过审批与接受邀请事务内重查资格，失败返回具体原因。资格下降不撤销现有职位。
- [ ] 开板／关联版主分别审批，开板未通过时关联任命不生效。重复批准只产生一个板块、一份授权。批准版主保存逐人逐板块权限。
- [ ] 审核意见／推荐仅向申请人和授权审核人员按用途展示，非本板块版主无法提交推荐。申请人只访问自己的申请，全站管理员审核全站申请。
- [ ] 更新退回、拒绝、通过、撤回记录及通知。拒绝后允许重申，无等待期。
- [ ] 运行 `npx vitest run apps/api/test/community-applications.int.test.ts apps/api/test/communities.int.test.ts apps/api/test/community-teams.int.test.ts`，包含并发批准、资格变化与重复请求。

## 任务 6　申请提交、我的申请与后台审核

新增 `components/community/CommunityApplications.tsx`、`components/admin/ApplicationReviews.tsx`，修改 `Pages.tsx`、`Application.tsx`、`AdminWorkspace.tsx`、`admin-api.ts` 及对应样式。路由延续现有社区页面导航模式，后台以 `view=applications` 和申请 id 打开独立详情，两个标签页分开板／版主。

- [ ] 板块列表加入开板入口，板块首页加入版主申请入口，资格不足展示实际数值与原因。个人中心统一「我的申请」。
- [ ] 开板填写名称、简介、理由、规则，可勾选版主申请并填写理由、管理设想及选填经验。已有板块申请同样字段。
- [ ] 后台详情展示资格、活动统计、处置历史、申请内容和审核历史，提供通过／退回／拒绝，批准版主时逐项调整默认权限。
- [ ] 提交后保留状态，重复点击受幂等保护，版本冲突提示刷新。补充、撤回、重申与推荐可从正确身份入口完成。
- [ ] 浏览器验收普通用户提交、管理员退回、用户补充、分别批准开板和版主、通知跳转及浏览器返回。新增 `tests/web/community-governance.py`，固定测试数据独立清理。

## 任务 7　板块简介与规则维护

修改 `communities.controller.ts`、`communities.service.ts`，工作台新 `CommunityBoardSettings.tsx` 和既有 SiteSettings。新增 `updateBoardDescription(actorId,{board,description,rules,expectedVersion,requestId})`，要求有效版主身份与 `boards.edit`，助手不能获得此项。

- [ ] 测试版主修改本板块成功，其他板块、助手、只读版主被拒绝，旧版本修改产生冲突。
- [ ] 更新后公开板块页、发帖提示与站点设置读取同一数据源，保存前后值与操作者。
- [ ] UI 每页单独保存，成功提示明确，未保存离开提示，错误不丢失输入。
- [ ] 板块改名／关闭／删除只归属全站管理员。实施时若缺少完整行为定义，单独列待设计项，不通过本任务增加破坏性删除。
- [ ] 运行 `npx vitest run apps/api/test/communities.int.test.ts apps/api/test/site-settings.int.test.ts` 并浏览器确认公开页即时更新。

## 任务 8　迁移、全链路验收与交付

- [ ] 迁移前记录本地数据基线与可恢复备份，验证现有六板块映射、版主成员授权和自定义群组无丢失。
- [ ] 执行 `npm run typecheck`、`npm test`、`npm run build:api`、`npm run build:web`，全部通过。
- [ ] 执行 `python tests/web/community-governance.py` 与既有 `python tests/web/dispositions.py`，使用独立会话和数据。
- [ ] 验证普通用户／助手／版主／全站管理员四种角色，新板块从申请到发帖、主动处置、助手邀请、权限调整、退出审批、创建者离任与转交全部走通。
- [ ] 1440、871、390 像素及明暗主题检查表格、权限表单、邀请弹窗、详情与返回交互。
- [ ] 更新实施记录，交付已完成项、验证结果和需要单独设计的项目。

## 技术建议待核对

1. 新板块先提供普通图文讨论功能，专用交易／问答功能保留给现有板块。
2. 复用群组授权基础，扩展团队类型与逐人授权。
3. 已任职人员不因资格门槛提高或发帖减少自动撤职。
4. 创建者转交后按新创建者权限上限恢复，邀请接受前的权限变化需重新展示并确认。
5. 本计划为一个主计划的八个可验收阶段。动态板块、授权、申请三个子系统接口在前述任务固定，按依赖顺序执行，任务 4 的资格接通在任务 5 完成后验收。

## 2026-11-11 助手申请入口调整验收

- [x] 将助手申请嵌入管理团队，提供接受和拒绝。
- [x] 移除版主侧独立申请管理入口，兼容旧链接和浏览器返回。
- [x] 浏览器回归覆盖拒绝后重申、接受后加入团队，以及 1440、871、390 像素下的详情宽度。
- [x] 通过类型检查与 Web 生产构建。

## 2026-11-11 版主邀请接受实施

- [ ] 新增版主邀请服务，复用申请存储、全局授权事务锁、通知与审计。
- [ ] 接通群组添加、板块分配和成员移除，阻止保存群组绕过邀请。
- [ ] 个人中心接受／拒绝，群组显示待接受并支持撤回。
- [ ] 接口验证未接受无权、资格变化、重复与并发接受、撤回、板块唯一性，更新浏览器流程并运行构建。

## 版主邀请流程验收完成

- [x] 复用 community_requests 保存邀请，群组新增成员与增加负责社区均在接受后授权。
- [x] 个人中心提供版主邀请和权限展示、接受与拒绝，接受后刷新当前登录权限。
- [x] 群组显示待接受邀请，支持撤回，移除成员同步撤回邀请。
- [x] 单板块唯一版主、接受时资格校验、重复与并发接受、撤回后的失效已通过接口测试。
- [x] 46 文件 153 测试通过，类型检查、API 和 Web 构建通过，浏览器从群组邀请到接受并进入团队管理流程通过。

实施决策为每个板块单独确认邀请，邀请权限按发出时保存，接受时与当前版主群组权限取交集。
