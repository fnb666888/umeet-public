# Multi-account Switching Implementation Plan

**Goal:** 同浏览器最多保存五个真实登录账号，有效期内点击切换，所有标签页同步且不串号。

**Architecture:** 沿用 NestJS/MySQL 会话。浏览器集合由 HttpOnly 随机凭证授权；每个已记住账号引用一条不可直接用于访问的 backing session，当前访问使用可轮换的子会话。撤销 backing session 会自然使记忆授权失效，不能借切换绕过改密、设备注销或近期验证。

**Tech Stack:** 现有 Next.js、React、NestJS、Kysely/MySQL、Zod、Vitest、Playwright，不增加认证供应商。

**Spec:** [用户已授权实施的调研方案](../../2026-11-13-multi-account-switching-research.md)。本计划记录实现取舍，直接执行，不重复请求批准。

## Global Constraints

- 最多五个，包括当前账号；重复账号更新原名额，第六个不得默默替换。
- 所有标签页统一身份；原账号的私人内容与原始认证时间保留。
- 前端不持有密码或可重放 token；设备凭证、当前会话均为 HttpOnly Cookie。
- 切换不能延长原登录绝对期限或把 `authenticated_at` 刷新为现在。
- 保留现有原生／小程序与独立会话，改密、退出、远程注销不能恢复已撤销授权。
- 只在本机隔离库迁移验证与配置测试账号；不部署线上，不改正式账号。
- 保留工作区已有修改；不创建包含他人改动的提交。

## Review Focus

- 两个页面同时添加第五／第六个账号：事务限额与版本检查。
- 切换到其他账号后旧访问凭证、旧页面请求及慢响应：拒绝跨身份写入／展示。
- 退出其他设备与删除除当前外会话：必须保留当前账号的 backing session。
- 重新登录同一账号及密码找回：独立原生会话不能被错误撤销，已失效记忆授权不能复活。
- Wiki 草稿保存失败、管理设置未保存和其他输入：切换前保存或明确阻止；其他标签页未确认时不切换。

### Task 1：模型与 API 契约

Files: `rebuild/packages/contracts/src/browser-accounts.ts`；`rebuild/apps/api/src/database/migrations/034_browser_accounts.ts`；`database.types.ts`、`migrate.ts`、`test/support/test-app.ts`。

Interfaces: `BrowserAccountState`（版本、当前身份、五条账号元数据与状态）；`BrowserAccountService.list/remember/switch/remove/logoutAll`。子会话记录记忆授权 ID，backing session 标志禁止用于普通认证。

- [x] 写真实数据库集成测试，先确认新模块缺失导致失败。
- [x] 建立集合与成员表、会话扩展字段、唯一约束和测试清理顺序。
- [x] 运行 `npx vitest run apps/api/test/browser-accounts.int.test.ts`、API 构建。

### Task 2：记忆、切换与撤销

Files: `modules/identity/browser-accounts.service.ts`、`browser-accounts.controller.ts`、`browser-session-state.ts`；修改 `password-auth.service.ts`、`account.service.ts`、`app.module.ts`。

Interfaces: `remember(deviceProof, verifiedLoginToken, expectedVersion?)`、`switch(deviceProof, accountId, expectedVersion)` 返回服务端内部 Cookie 载荷和可公开状态；`assertBrowserWriteContext(token, expectedActor, expectedVersion)` 保护子会话写入。缺少／不匹配的账号绑定在浏览器会话上拒绝，原生独立会话继续兼容。

- [x] 验证 A→B→A、重复账号、五名额、并发添加、外部集合 ID、过期和停用。
- [x] 实现集合行锁、会话轮换、实时角色摘要与原始时间／期限继承。
- [x] 更新 logout、远程注销和“其他设备”逻辑，验证改密清除 backing session 后不能再切回。
- [x] 加全局 API 写请求身份检查，运行集成测试和现有认证／设备测试。

### Task 3：Web Cookie 与 BFF 接线

Files: `apps/web/src/lib/browser-accounts-server.ts`；`app/api/session/[action]/route.ts`、`app/api/verification/[action]/route.ts`、`app/api/backend/[...path]/route.ts`。

Interfaces: 登录／注册／验证码结果先绑定记忆集合再写 Cookie；GET accounts/context 返回安全元数据；POST switch/remember/remove/logout-all 接受目标 ID 与集合版本，均验证 Origin。

- [x] 有效的既有会员 Cookie 可在初始化时通过 remember 迁入，无需再次输入凭证。
- [x] 会话 Cookie 或 token 不进入 JSON／localStorage；转发预期账号与版本；第六个账号失败时保留旧活动身份。
- [x] 原生 mobile proxy 不自动加入浏览器集合。
- [x] 运行类型检查，浏览器验证 Cookie 标志和实际登录 API。

### Task 4：标签页协调与未保存内容

Files: `components/AccountSessionProvider.tsx`、`lib/browser-session.ts`；修改 `app/layout.tsx`、`knowledge/useKnowledgeDraft.ts`、`admin/use-unsaved-settings.ts`。

Interfaces: `prepareAccountChange()` 收集同源标签页保存确认与待完成请求；`finishAccountChange()` 通知所有标签页刷新；全局 fetch 包装在写请求开始时固定身份与版本，并拒绝旧身份慢响应。

- [x] 在加载业务子树前初始化上下文，避免第一次写入缺少身份绑定。
- [x] Wiki 通过 `waitUntil(flush())` 保存；管理设置使用既有取消离开规则；未保存普通输入阻止切换。
- [x] 多标签页 prepare/ack/cancel/commit；未响应页面明确报错，不静默丢稿；失去广播时焦点复核与后端检查兜底。
- [x] 写交互测试覆盖失败重试、慢响应与跨标签页切换。

### Task 5：账号选择器

Files: `components/AccountSwitcher.tsx`、`account-switcher.css`；修改 `DemoAuthDialog.tsx`、`community/Profile.tsx`、相关入口。

- [x] 切换入口默认打开账号列表，展示头像、用户名、动态角色范围、当前／过期／停用状态与 5/5 名额。
- [x] 添加账号沿用正常密码／验证码表单；一次成功后记忆；取消不改变当前身份。
- [x] 移除一个、退出当前、退出本浏览器全部账号分开；当前账号点击无副作用；退出不自动登录管理员。
- [x] 手机、键盘、错误恢复、管理页降权后安全导航、未保存提示验证。

### Task 6：五角色与完整回归

Files: `tests/web/browser-accounts.py`、`apps/web/test/browser-accounts.test.tsx`；更新 `scripts/setup-local-role-accounts.ts` 仅在兼容需要时修改；验收文档 `docs/2026-11-13-multi-account-switching-acceptance.md`。

- [x] 现有五个测试账号真实添加、点选、重启上下文后恢复、两标签页同步。
- [x] 测试限额、过期、注销、改密、二次验证时间、角色权限及私人内容隔离。
- [x] 运行专项、`npm run typecheck`、`npm test`、`build:api`、`build:web` 与浏览器测试，重任务串行以避免内存争用。
- [x] 核对原登录和 Wiki 流程；记录失败修复、证据与未部署范围，更新完成状态。

自检：需求均已映射到任务；方案中的记忆登录授权采用不可直接访问的 backing session，因此现有批量删除会话能撤销授权，设备列表与当前会话例外需单独接线。实际接口和测试若因项目现状调整，在验收记录中说明。

完成记录：2026-11-13，193 项完整回归通过；五角色与标签页实际浏览器验收通过。实现文件位置按当前目录调整，详见 `docs/2026-11-13-multi-account-switching-acceptance.md`。
