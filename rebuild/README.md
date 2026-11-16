# Umeet 全新实现

按已确认方案执行中：Next.js 网站、NestJS API、MySQL、微信原生TypeScript小程序，部署目标为**微信云托管**。

当前已实现并验证本地密码/游客认证、验证码与登录方式绑定代码、会话、个人记录、社区基础和 Wiki 网站流程（双模式编辑、冲突合并、历史差异、回滚、引用）。仍不是完整可上线应用。登录由 NestJS/MySQL 管理，不接 CloudBase 认证；部署目标是微信云托管。

## 本地检查

Node24，`npm ci` 后使用 `npm run check`。API集成测试需要独立MySQL实例，默认仅连接127.0.0.1:19316/umeet_rebuild_test；可用TEST_MYSQL_URL指定另一个本地测试库，库名必须符合安全校验。不运行生产迁移。

`npm run verify:capabilities -- --report`查看能力记录；`--release`遇到未验证能力会失败。

`npm run verify:capabilities -- --local`运行真实Milkdown探针。`npm run test:contracts`检查DTO边界。`npm run test:api`运行真实MySQL事务与API集成测试。

`npx tsx scripts/prepare-local.ts` 初始化独立的本地开发库；按 `.env.example` 设置环境后，`npx tsx apps/api/src/main.ts` 运行 API，`npm run dev --workspace=@umeet/web` 运行网站（5178端口）。`PUBLIC_WEB_ORIGIN` 正式环境必须设置成实际 HTTPS 网站来源，不使用客户端传来的 Host 判断可信来源。

`python tests/web/access.py` 使用本机 Python Playwright / Edge 验证游客草稿、升级、退出、重登、HttpOnly 和跨站来源拒绝；测试只访问本机服务，不上传或发布。

`npm run e2e:web` 运行账号与 Wiki 两套浏览器流程；`npm run e2e:web -- wiki.spec.ts` 单独验证词条。`npm run build:api` 与 `npm run build:web` 分别构建两个服务。

邮箱和短信的代码、开关、限额及配置模板已完成，发送服务尚未准备，默认关闭。SMTP 已通过本地真实 TLS 测试，短信只做了隔离传输测试；真实供应商、微信设备和资源检查尚未验收。没有演示认证后门，本地测试不等于四渠道生产验证完成。

微信小程序后端适配已实现，只有设置 `WECHAT_MINI_APP_ID` 和 `WECHAT_MINI_APP_SECRET` 才启用；只在服务端配置，不放到小程序包或浏览器。`WECHAT_OPEN_PLATFORM_REALM` 仅在确认多个应用共用同一开放平台身份范围后设置。默认不会自动读取旧项目凭据。真实 code/设备验证、网站微信扫码和微信身份绑定仍未完成。

验证码配置与本地测试见 [认证操作说明](docs/operations/authentication.md)。API/网站模板分别位于 `deploy/cloudhosting/api.env.example` 和 `web.env.example`。`npm run auth:check` 只报告配置状态，不发消息、不显示密钥。网站在 `/me/security` 管理登录方式；未配置的验证码入口保持禁用。

API 内持久化处理器、租约续期/恢复、死信、管理员重试与版本化上传限额已实现；见 [后台任务与限额说明](docs/operations/jobs.md)。具体审核、索引和通知处理器在后续业务模块接入。
