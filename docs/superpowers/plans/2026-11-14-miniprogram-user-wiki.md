# 小程序普通用户与 Wiki 实施计划

**Goal:** 原生小程序与网站同账号、同内容、同视觉，完成普通用户与 Wiki 全流程。
**Architecture:** 新版 API 提供受控分页移动视图，共用网站写入服务；原生页面统一会话、设计变量和 Markdown/公式渲染，私人草稿按账号隔离。
**Tech Stack:** TypeScript/WXML/WXSS、现有 NestJS/MySQL、Vitest、wechatide 0.3.11。
**Spec:** `docs/superpowers/specs/2026-11-14-miniprogram-user-wiki-design.md`（用户已明确要求按方案实施）。本会话直接执行，不重复申请方案批准。

## 全局约束与复核重点

- 同网站设计变量；普通用户完整闭环，管理留网页；不部署正式环境。
- 使用网站主社区实体与写入规则；不得另建相似帖子库。客户端只取得分页数据。
- 登录变更、旧请求、草稿和私信按账号隔离；失败不清空输入。
- Wiki 公式不能退化成漏显的纯文本；目录、路线、关系、审核规则与网站一致。
- 微信真实 code 验证单独记录，开发者工具登录不冒充应用登录。
- 验证重点：权限过滤、并发草稿、分页遗漏、旧登录响应和图片/公式持久显示。

### 1. 移动端读取与安全边界
Files: `rebuild/apps/api/src/modules/mobile/*`、`app.module.ts`、`rebuild/apps/api/test/mobile.int.test.ts`。
- [ ] 写分页、隐藏内容、匿名、个人资料、评论与账号隔离的失败测试。
- [ ] 实现社区 feed/detail/profile/notices/state，复用 `DemoSnapshotsService` 权限与写操作，API 返回有界投影。
- [ ] 为小程序代理列出普通用户需要的精确读写路径；禁止管理接口、任意转发。
- [ ] 通过 API 专项、类型检查。

### 2. 统一会话、环境与视觉
Files: `apps/miniprogram/src/utils/{api,session,theme}.ts`、`config.ts`、`app.ts/app.wxss/app.json`、`apps/miniprogram/scripts/*`。
- [ ] 会话及失败请求单元测试；保留未知作者旧稿，隔离新稿。
- [ ] 所有页面只使用一套新版 Bearer 身份；环境分开，开发使用本地接口，正式使用 HTTPS。
- [ ] 网站 CSS 语义变量生成 WXSS；统一图标、控件和深浅主题，底栏社区/Wiki/消息/我的。
- [ ] 完成构建与资源检查。

### 3. 社区与个人闭环
Files: `pages/community`、`pages/me`、`features/{detail,publish,records,account,settings,profile,governance}`、共享组件。
- [ ] 分页列表、检索、板块、帖子详情与分页回复、点赞收藏举报、分享。
- [ ] 发帖/编辑、图片、板块字段、幂等、按用户保存恢复草稿。
- [ ] 登录/微信绑定、资料、发布与收藏、申请/邀请/记录/申诉，失败可恢复。
- [ ] 在本地模拟器验证两个普通用户和站点数据互通。

### 4. Wiki 读取、渲染与编辑
Files: `pages/knowledge`、`features/knowledge-*`、`components/markdown`、API mobile Markdown 渲染服务及测试。
- [ ] 验证 Markdown 段落、表格、内部链接、行内/块公式的原生渲染；选择正式实现。
- [ ] 搜索、词条、目录、学习路线、关系、历史/差异与纠错。
- [ ] 创建、模板、关系目标检索、Markdown/预览、服务器私人草稿及本地未同步备份。
- [ ] 普通用户提交审核、退回修改重提、版本冲突、离开保存失败保护。
- [ ] 物理三分支与校园手册真实样例验收。

### 5. 消息与通知
Files: `pages/messages`、`features/conversation`，复用现有消息 API。
- [ ] 会话与请求分页、未读、接收/忽略、发消息、分页历史、重试、屏蔽和举报。
- [ ] 系统通知单列；定位相应帖子/词条/申请。
- [ ] 验证不同账号与限制状态不会串数据。

### 6. 整体验收
Files: `scripts/check-mini.mjs`、小程序单元/集成/自动化、`docs/2026-11-14-miniprogram-acceptance.md`。
- [ ] 本地构建、类型检查、相关 API 与小程序测试、完整回归。
- [ ] wechatide 编译、页面/日志/网络、真实操作与截图核对同网站风格。
- [ ] 记录真机/微信凭证等外部条件的准确状态；不伪称验证，不发布线上。

自检：所有已确认要求覆盖以上六项；实施顺序只表示施工，不削减最终范围。采用本会话执行与最终独立审查，保留现有工作区，不自动推送主分支。


## 本次执行结果

代码实施已覆盖 1—5 项，最后构建、类型与专项通过。设备验收完成社区、双用户私信、Wiki 草稿提交及公式显示；后期开发者工具自动化导航连续超时，最终设备验收尚未全部完成。详见 `docs/2026-11-14-miniprogram-acceptance.md`，保留未完成验收项，不将其勾选为通过。

2026-11-14 续验：修复整包 WXML 编译错误后，20 页及剩余模拟器流程均通过，已获用户直接发布授权，开始生产发布流水线。真实微信与手机事项仍单列。
