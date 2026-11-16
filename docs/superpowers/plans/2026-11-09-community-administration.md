# Community Administration Implementation Plan

**Goal** — 完成当前网站可使用的全站管理闭环。

**Architecture** — NestJS 管理模块读取现有实体与举报。MySQL 独立管理表记录状态与幂等操作。Next.js /admin 客户端通过已有同源代理访问。

**Tech Stack** — Next.js 16、React、NestJS、Kysely、MySQL 8、Vitest。

**Spec** — docs/superpowers/specs/2026-11-09-community-administration.md

## Global Constraints

- 保留现有账号和内容，维持自由发布。
- 后端检查 owner/admin，所有操作填写原因。
- 当前阶段为全站管理员，不增加分社区授权。
- 本次在当前会话执行并自行复核。

## Review Focus

- 旧举报和旧 Wiki 历史能正常处理。
- 隐藏回复的引用不会泄露原文。
- 操作重试只产生一条记录和一份通知。
- 并发 Wiki 修改通过版本冲突保护。
- 禁言覆盖批量操作和私信路径，到期可继续使用。

## Tasks

- [x] 在 packages/contracts/src/admin.ts 定义管理查询、详情和动作。新增 019 migration 和 Kysely 类型，更新测试清理。
- [x] 在 modules/admin 新增控制器、服务和禁言检查，复用 requirePlatformAdmin。以 admin.int.test.ts 覆盖权限、事务、重试和举报。
- [x] 修改 DemoSnapshotsService 公开读写与 MessagingService.send，覆盖隐藏引用和禁言到期测试。Wiki 恢复新增历史并检测 baseRevision。
- [x] 新增 /admin 页面、独立样式及管理组件，代理开放 admin，头像菜单按角色显示入口。新增受控管理员初始化命令。
- [x] 运行完整测试、类型检查、API/Web 构建，安全重启本地预览并通过浏览器检查工作流与响应式布局。

## Verification

- 全量 33 个测试文件、132 项测试通过。
- 类型检查、API 构建、Web 构建通过。
- 浏览器检查涵盖未登录和普通用户拒绝访问、内容隐藏恢复、举报处理结论、禁言和解除、Wiki 版本比较与恢复。
- 390px、714px、1440px，浅色与深色主题均通过，无横向页面溢出或浏览器脚本错误。
- 本地预览账号 design_d9faefe1 已授予 admin。测试生成的帖子、Wiki、举报和对应操作记录已清理。

## Administrator setup

在 rebuild 目录运行 npm run admin:grant -- 用户名，使用服务端已有 DATABASE_URL。命令仅授予已存在且有效的账号权限，重复执行不重复添加，并写入审计记录。
