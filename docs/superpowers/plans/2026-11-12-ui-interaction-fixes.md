# UI Interaction Fixes Implementation Plan

**Goal:** 修复交互审查 U01–U09、A01–A07，并逐项复测。
**Architecture:** 保留 React/Next.js 与现有样式变量。认证弹窗统一身份与焦点处理；设置草稿保护独立 hook；管理确认文案从具体动作生成。
**Tech Stack:** React、TypeScript、Next.js、Vitest、Playwright 浏览器验收。
**Spec:** docs/2026-11-12-ui-interaction-audit.md（用户已授权按建议修复）。

## Constraints
- 保留已有未提交改动，不修改后端权限和认证协议。
- 取消和失败保留当前登录身份，不持久化凭据；敏感处置必须显示明确目标与后果。
- 未保存保护覆盖全部设置页签、侧栏、返回社区、刷新；取消离开必须保留输入。

## Tasks
- [x] 1. DemoAuthDialog、Application、Account、Icon：切换图标、当前身份、登录并切换、独立辅助分支、焦点回退、通知状态、危险区与操作间距。
- [x] 2. Profile、Composer、PostEditor：设置路由与 aria-current，发帖错误字段关联及定位。
- [x] 3. SiteSettings、AdminWorkspace：全页签未保存保护、操作者身份与账号入口、空结果恢复与零条分页。
- [x] 4. AdminDetails、CommunityTeams、admin.css：处罚目标/范围/期限/后果、危险菜单、团队空状态、窄屏导航与操作组。
- [x] 5. 新增交互回归测试；运行类型检查、相关用例，按审查路径截图并记录 U/A 项验收结果。

## Review Focus
- 菜单隐藏后焦点仍应回到可见入口；Esc 和关闭行为一致。
- 验证码与密码登录均支持切换；失败不会刷新身份。
- 设置的非当前页签也可能有未保存修改；导航监听不得双重确认。
- 处罚期限自定义、永久与社区范围应显示正确，接口负载保持不变。
- 窄屏、空记录、无身份/加载失败仍可恢复操作。
