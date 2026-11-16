# 内容与用户处置实施计划

> **For agentic workers**
> 按复选框逐项实施与验收。执行参考 superpowers:executing-plans，当前技能目录未提供该技能时按本计划在当前会话逐项执行。独立代理评审需遵守会话的代理使用授权。

**Goal**

落实统一的参与限制、两级全站处置、组合举报处理、逐项申诉和可区分的处置记录。

**Architecture**

复用现有管理接口、Kysely 事务和权限体系。保留 admin_actions 作为一次提交的审计根，在内部建立可独立撤销的处置效果与限制版本关系。服务端统一校验行为权限，前端基于同一状态显示可用操作。

**Tech Stack**

Next.js 16、React 19、NestJS 11、TypeScript、Zod、Kysely、MySQL、Vitest、Python Playwright。

**Spec**

[已确认需求及技术建议](../specs/2026-11-10-moderation-dispositions-design.md)。

## 全局约束

- 三种限制期限均提供 1 天、7 天、30 天、自定义、永久，永久使用空到期时间。
- 社区内容组合处置中，全站管理员默认全站范围，社区管理人员仅可使用授权社区范围。
- 群组统一「处置用户」，包括警告、限制、调整和解除，社区永久限制遵循同一授权。
- 账号保护、举报人隐私、独立复核、多群组和版主按成员授权社区等现有规则继续生效。
- 同次处理只产生一条主记录，内容与用户效果可分别复核。请求重试、并发和通知均应保持一致。
- 当前工作区有大量既有改动，任务提交仅包含本次可分离的改动。执行前记录差异，提交前逐文件审核。
- 所有命令从 rebuild 执行。前端修改先读取 apps/web/AGENTS.md 和相关 Next.js 本地文档。

## 代码职责图

| 文件 | 职责 |
| --- | --- |
| packages/contracts/src/admin.ts | 处置输入、效果输出、申诉逐项结果、错误及列表合同 |
| packages/contracts/src/moderation-permissions.ts | users.manage 权限、模板及旧权限兼容映射 |
| apps/api/src/database/migrations/028_moderation_dispositions.ts | 新字段和效果表、旧处置与群组权限迁移 |
| apps/api/src/database/database.types.ts、migrate.ts | 表类型及迁移注册 |
| apps/api/src/modules/admin/dispositions.ts（新增） | 参与限制状态、版本更新、撤销及效果关联 |
| apps/api/src/modules/admin/restrictions.ts、scope.ts | 行为校验、范围授权、账号层级保护 |
| apps/api/src/modules/admin/admin.service.ts、business-actions.ts、admin.controller.ts | 组合处理、记录投影、列表和申诉复核 |
| apps/api/src/modules/admin/governance.service.ts、governance.controller.ts | 用户处置查询及一次申诉 |
| apps/api/src/modules/demo/demo-snapshots.service.ts、demo.controller.ts | 现有主界面读写入口的限制校验与状态输出 |
| apps/api/src/modules/discussions/discussions.service.ts、wiki/wiki.service.ts、messaging/messaging.service.ts | 独立帖子、Wiki、私信接口的限制校验 |
| apps/api/src/modules/identity/password-auth.service.ts、auth.controller.ts、account.controller.ts、account.service.ts | 受控登录、安全维护及停用状态 |
| apps/web/src/components/admin/AdminDetails.tsx、AdminWorkspace.tsx、admin-api.ts、admin.css、PermissionGroups.tsx | 举报、用户、受限用户、记录、申诉和授权界面 |
| apps/web/src/components/community/Governance.tsx、Application.tsx、store.tsx、model.ts、account-client.ts | 用户处置提示、操作禁用和申诉状态 |
| apps/web/src/app/account/dispositions/page.tsx（新增）、components/community/AccountDispositionPage.tsx（新增） | 停用账号的专用受控入口 |
| apps/web/src/components/ApplicationShell.tsx、app/api/session/[action]/route.ts | 专用页外壳和会话接入 |

## Review Focus

1. 旧库迁移中途失败及重跑，原原因、期限、来源关联和历史申诉必须可追溯，见任务 2。
2. 两位管理员同时更新或解除同一限制，必须避免多条当前记录和静默覆盖，见任务 3。
3. 登录前后及浏览器旧会话遇到停用状态，只能进入允许入口，申诉和安全维护仍可用，见任务 4。
4. 跨社区或共享 Wiki 写入、整批操作中夹带受限行为，必须按资源真实范围校验并整体回滚，见任务 4。
5. 申诉期间新处置覆盖旧限制，撤销旧处置必须保留后续效果，见任务 6。

## Task 1 — 共享合同与权限

**Files**

修改共享 admin.ts、moderation-permissions.ts 及 packages/contracts/test/contracts.test.ts。

**Interfaces**

- 定义 DispositionKind 为 warning、participation、deactivation。deactivation 仅允许全站范围。
- 定义 DispositionInput 为 kind、userId、scope（global 或 community）、board、hours（1 至 8760 或 null）、reason、expectedVersion。警告无需期限，空到期时间代表永久。
- 定义 DispositionEffect 为 id、actionId、type（content.delete 或用户处置类型）、target、scope、board、version、until、status、reason。
- 扩展 case.resolve，增加可选 authorDisposition，支持内容与作者不同范围。扩展 appeal.review，传入 effectId 与维持或撤销的 decisions 列表。
- users.manage 是新群组操作权限，自动包含 users.view。旧 users.mute、users.suspend 由兼容层映射，旧写入接口进入同一处理路径。

- [ ] 添加合同用例，校验 24、168、720 小时和 null，拒绝非法范围、空原因、社区停用账号、重复效果及不匹配期限。
- [ ] 运行 `npx vitest run packages/contracts/test/contracts.test.ts`，确认新增断言在实现前失败。
- [ ] 更新合同、模板和权限依赖，旧 users 大类和单项授权均可归一化为 users.manage。
- [ ] 重跑合同测试及 `npm run typecheck`。类型切换期间保留兼容分支供后续任务接入。

## Task 2 — 数据结构与可恢复迁移

**Files**

新增 028_moderation_dispositions.ts 及 apps/api/test/moderation-dispositions-migration.int.test.ts。修改 database.types.ts、migrate.ts、test/support/test-app.ts。

**Interfaces**

- moderation_penalties 增加 source_action_id、version、superseded_by。旧字段继续保留，追加新版本后原版本标为已替代。
- 新表 moderation_action_effects 保存 id、action_id、type、target、board、penalty_id、before_data、after_data、reversed_by、created_at。id 为主键，action_id 建索引。每个效果关联一次原始提交。
- 迁移以用户、范围、类型归并有效记录，来源 ID 保存在效果快照内。兼容 legacy admin_restrictions、community_restrictions 与 moderation_penalties。

- [ ] 构造迁移前数据库，覆盖剩余期限、已到期、已解除、永久、多个原因、旧 case.resolve 关联、已有申诉和混合权限群组。
- [ ] 运行迁移专用用例并确认缺少迁移时失败。
- [ ] 完成幂等建表和字段扩展，再在事务内转换数据及权限。禁止改写原 admin_actions 快照，历史来源可查。标记已迁移来源，重跑不会重复追加效果。
- [ ] 验证合并取最晚到期、永久优先，保留各原因及关联。旧非本次范围的细分限制保持原效果。
- [ ] 验证失败后重跑和再次启动不重复迁移，更新测试清理顺序，然后运行迁移及原群组测试。

## Task 3 — 用户处置、版本与并发

**Files**

新增 dispositions.ts、apps/api/test/moderation-dispositions.int.test.ts。修改 business-actions.ts、admin.service.ts、scope.ts、restrictions.ts。

**Interfaces**

- applyDisposition(tx, actorId, input, actionId) 返回 DispositionEffect。
- revokeDisposition(tx, actorId, effectId, expectedVersion, reason, actionId) 返回解除效果。
- getDispositionState(db, userId) 返回当前社区限制、全站限制参与、停用账号及版本。
- 同一用户操作锁定 users 行，读取当前有效版本后比较 expectedVersion。冲突返回 DISPOSITION_VERSION_CONFLICT。新限制追加版本，原限制保留替代关系。

- [ ] 添加并运行失败用例，覆盖警告、永久、重设期限从现在计算、三类独立计时、解除后列表消失、期限自然结束。
- [ ] 接入 users.manage、社区权限和 requireAccountManagement，所有旧写入入口走相同的授权与状态服务。
- [ ] 用原请求 ID 及内容指纹保证重试仅写一次记录、效果和通知。相同 ID 不同输入返回冲突。
- [ ] 测试并发更新与解除，预期仅一个匹配版本成功，另一个收到可重试冲突，且不存在两条当前限制。
- [ ] 运行新测试和 group-management、moderation-groups、moderation-workspaces 回归。

## Task 4 — 行为限制及停用后的受控入口

**Files**

修改代码职责图中的 restrictions、demo、discussions、wiki、messaging、identity、会话代理及专用处置页。修改对应 API 测试，新增 apps/api/test/disposition-access.int.test.ts。

**Interfaces**

- requireCapability 和 requireUnrestricted 使用任务 3 的状态。participation 阻止对应范围的 publish、投票和 wiki，global participation 额外阻止 messages。
- 常规 authenticate 默认拒绝 deactivation，明确允许的会话、governance 和必要安全维护入口使用受控认证。登录成功后依据状态转到 /account/dispositions。
- 专用页仅依赖会话、个人处置及安全维护接口，不依赖完整社区快照。前端状态输出包含有效限制和精确结束时间。

- [ ] 添加行为矩阵，逐一验证发帖、回复、内容编辑、帖子和回复投票、Wiki 保存及修订、发送私信、浏览和申诉。
- [ ] 测试社区限制仅影响资源所属社区，共享 Wiki 只要涉及受限社区即拒绝写入。限制不影响其他社区私信或参与。
- [ ] 检查每个现有写入入口和操作类型，避免整包 demo operations 绕过，混合批次任何操作失败时全部回滚。
- [ ] 测试停用前已有会话、密码登录、OTP 和已支持的其他登录方式，均进入相同受控状态。专用页可看原因、期限、提交申诉、退出和必要安全维护。普通 API 继续拒绝。
- [ ] 运行 identity、password-auth、auth-http、otp-http、discussions、wiki-revisions、messaging、demo 及新访问测试。

## Task 5 — 举报组合处理与一条主记录

**Files**

修改 admin.service.ts、business-actions.ts、governance.service.ts、admin.controller.ts、contracts/admin.ts，扩展 moderation-workspaces.int.test.ts 和 moderation-dispositions.int.test.ts。

**Interfaces**

- case.resolve 在一个事务中完成内容删除、可选作者限制、举报结案、效果关联及通知。authorDisposition.scope 与内容社区范围分别检查。
- AdminItem 增加 effects，用于一次提交的摘要与展开明细。列表 total 按主操作计数。用户个人历史和举报详情引用同一 actionId。
- 全站管理员默认范围由前端明确发送，后端要求显式合法范围，拒绝社区管理人员传入全站。

- [ ] 添加失败用例，覆盖只删除、删除并永久社区限制、删除并全站限制、驳回不修改用户状态、作者账号保护和跨社区伪造输入。
- [ ] 删除成功但用户处置失败时整体回滚。并发提交相同举报只能一次成功结案，重试返回原结果。
- [ ] 原子保存一条主记录及多个效果，通知接收者去重，每位接收者每次操作收到对应的完整结果。
- [ ] 管理记录摘要包含动作、范围、期限、原因、操作人和时间，历史旧动作按兼容投影显示可理解名称。
- [ ] 验证恢复内容追加记录、原举报仍已结案，用户限制继续保持。运行举报、处置及原 admin 集成测试。

## Task 6 — 一份申诉与逐项复核

**Files**

修改 governance.service.ts、business-actions.ts、admin.service.ts 和共享合同。扩展 moderation-business.int.test.ts、新处置集成测试。

**Interfaces**

- 一份申诉仍以 actionId 为入口，查询该操作所有可复核效果。decisions 必须覆盖整份申诉中的效果，每项为 uphold 或 reverse。
- 复核权限取全部效果的范围，授权必须满足所有项目。混合全站和社区效果仅全站管理员可复核，账号层级保护继续校验。
- 旧效果已被后续版本替代时，撤销只标记旧效果。解除当前版本需额外显式选择、当前版本及相应权限校验，并作为新变更留痕。

- [ ] 添加四种结果测试，两项都维持、仅恢复内容、仅撤销限制、两项都撤销。
- [ ] 测试自己的处置、无权处理某个效果、重复复核、并发复核和已注销用户，验证失败不产生部分撤销。
- [ ] 实现逐项撤销和通知，保留原结案状态。旧单项申诉映射到一个效果，混合结果明确展示逐项结论。
- [ ] 测试旧 7 天限制申诉期间更新为 30 天，撤销旧处置不影响当前限制，显式解除当前限制时必须检查新版本。
- [ ] 重跑 moderation-business、moderation-workspaces、group-management 及新处置测试。

## Task 7 — 管理端及用户端交互

**Files**

修改职责图中的管理组件、Governance、社区状态及 admin.css，新增 tests/web/dispositions.py。

**Interfaces**

- 举报独立详情显示保留与删除，删除表单可勾选同时限制作者，社区人员范围固定，全站管理员默认全站并提供切换。
- 统一期限控件显示 1 天、7 天、30 天、自定义、永久，警告隐藏期限。操作后刷新当前状态，冲突提示重新加载。
- 用户详情状态旁保留操作菜单，提供警告、限制、调整和解除。社区受限用户移除旧禁言和封禁分类，显示单一列表及搜索。
- 全站用户分类改为全部用户、活跃用户、新用户、管理人员、限制参与、已停用。群组只展示统一处置用户权限。
- 申诉显示逐项选择和后续处置提示，管理记录展示同次动作摘要及可展开详情。

- [ ] 先以 Playwright 编写流程断言，覆盖删除并限制、确认范围、永久、用户菜单、受限用户查询及解除、逐项申诉复核。
- [ ] 完成管理界面和专用停用页，保留列表与详情返回、搜索条件、键盘焦点及已选社区。
- [ ] 用户侧在对应操作处提示限制范围、原因和期限，服务端继续负责最终校验。
- [ ] 在 1440、871、390 像素及浅深色验证页面，检查表单溢出、长原因、多人同名、永久和多个社区限制，保存截图逐张检查。
- [ ] 运行 `python tests/web/dispositions.py`，使用独立测试会话及可清理数据，保护用户当前浏览器会话。

## Task 8 — 集成验收与本地切换

- [ ] 运行 `npm run typecheck`、`npm test`、`npm run build:web`、`npm run build:api`，确认全部通过。此前基线为 39 个测试文件、142 项测试。
- [ ] 在测试库重复验证迁移，核对迁移前后的有效限制数量、最终到期时间、原操作关联和群组范围。
- [ ] 本地数据库切换前保存相关表的可恢复快照，记录当前版本。MySQL DDL 与数据回填分别处理，验证失败可恢复，避免直接依赖事务回滚 DDL。
- [ ] 执行本地迁移并重启 API，使用独立全站管理员、版主及普通用户会话完成删除加限制、申诉部分撤销、限制到期和停用后申诉。
- [ ] 审核本次差异，按任务边界提交可分离文件，最终向用户报告验证结果、迁移效果与仍存在的问题。

## 自查结果

需求稿各节均有任务承接。迁移归并对应任务 2，版本与权限对应任务 3，行为矩阵及停用入口对应任务 4，组合记录对应任务 5，逐项申诉对应任务 6，页面对应任务 7。五项 Review Focus 均有具体用例。

建议按上述顺序在当前会话逐项实施。数据模型、认证及申诉相互依赖，完成各任务测试后再进入下一项。

## 实施与验收记录 · 2026-11-11

已接入统一处置合同、users.manage 权限、028 数据迁移、限制版本更新、组合举报处理、逐项申诉复核、管理页面及停用账号专用申诉页。旧 restriction 和 penalty 写入入口接入统一限制逻辑。限制版本使用不可变处置 ID，expectedVersion 比较该 ID。

验收结果如下。

- npm run typecheck 通过。
- npm test 通过，43 个测试文件、148 项测试。
- npm run build:api 和 npm run build:web 通过。
- python tests/web/dispositions.py 通过，使用自动创建和清理的隔离账号与帖子。
- 浏览器覆盖组合删除与永久社区限制、版主受限用户菜单、部分申诉撤销、停用后申诉及身份验证，在 1440、871、390 像素截图检查页面。举报表单覆盖浅色与深色。
- 迁移测试覆盖旧禁言与封禁转换、永久优先、重复有效限制合并、历史来源和申诉关联、权限转换与重复执行。
- API 测试覆盖四种组合申诉结果、混合全站范围申诉分流、禁止自审、后续限制版本保护、并发更新冲突、资料维护和参与行为限制、停用后密码与邮箱重新验证。

本地数据库已备份到 rebuild/.runtime/dispositions-db-before.json 并执行迁移，原有两条有效处置转换为参与限制，验收临时数据已清理。前端 5178 和 API 3188 已运行新版。

本次实现保留在当前工作区。既有管理模块与本次修改交织，尚未拆分为独立 Git 提交。
