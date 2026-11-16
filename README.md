# Umeet · 让社区讨论成为共同的知识

[English](README.en.md) · [参与共建](CONTRIBUTING.md) · [Issues](https://github.com/fnb666888/umeet-public/issues) · [0BSD](LICENSE)

**面向学生与兴趣社群的开源社区：连接讨论、互助、知识整理与社区治理。**

一条有用的回答，不该随着信息流消失。Umeet 希望让成员既能发起讨论、寻找同伴，也能把经验整理成持续修订的 Wiki 和学习路径。从课程小组到校园社团，我们欢迎一起探索社区的更多可能。

## 我们在做什么

- 社区讨论：板块、帖子、回复、搜索和个人记录。
- 知识协作：Wiki、Markdown 与公式编辑、修订历史、差异比较及审核。
- 社区治理：举报处理、权限、成员管理与后台。
- 身份与消息：游客/成员身份、会话、多账号切换与登录方式管理。
- 探索模块：兴趣发现、资讯与 AI 辅助预测，需要自行配置外部服务。

项目仍在积极开发。现有实现和测试不代表所有功能都已完成生产验收；微信真机、邮件/短信、外部 AI 与实际部署需要按环境验证。

## 代码导航

当前网站与 API 主要位于 **`rebuild/`**：Next.js / React、NestJS、MySQL、Kysely、TypeScript。微信小程序位于 `apps/miniprogram/`。根目录 Vue 后台与 API 是早期实现，使用另一套启动命令和数据库配置。

| 目录 | 内容 |
| --- | --- |
| `rebuild/apps/web/` | 网站与管理界面 |
| `rebuild/apps/api/` | API、账号、治理、后台任务 |
| `rebuild/packages/` | 共享契约与 Markdown 能力 |
| `rebuild/tests/` | 浏览器流程验证 |
| `apps/miniprogram/` | 微信原生 TypeScript 小程序 |
| `makers-agent/` | AI Agent 探索模块 |
| `rebuild/deploy/` | 部署模板 |

## 本地启动

需要 Node.js 24、npm 和 Docker。以下数据库仅用于本机开发，绑定回环地址。

```bash
git clone https://github.com/fnb666888/umeet-public.git
cd umeet-public/rebuild
npm ci
docker run --name umeet-dev-mysql -e MYSQL_ALLOW_EMPTY_PASSWORD=yes -p 127.0.0.1:19316:3306 -d mysql:8.0
```

等待 MySQL 就绪，复制当前目录 `.env.example` 为 `.env`，然后执行：

```bash
npx tsx scripts/prepare-local.ts
node --env-file=.env --import tsx apps/api/src/main.ts
```

另开终端，从 `rebuild/` 启动网站：

```bash
node --env-file=.env node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1 --port 5178
```

访问 <http://127.0.0.1:5178>，API 位于 `http://127.0.0.1:3188`。邮箱/短信默认关闭，完整注册需要配置发送服务，见[认证说明](rebuild/docs/operations/authentication.md)。请勿将开发数据库暴露到公网。

小程序：从仓库根目录执行 `npm ci` 和 `npm run build --workspace=@umeet/miniprogram`，填写自己的 AppID，再用微信开发者工具打开仓库根目录。开发版默认访问本机 `5178/api/mobile`；真机需配置可达地址。发布前替换 `apps/miniprogram/src/config.ts` 的示例生产域名，并配置微信合法域名。

## 一起共建

不必先读懂整个项目。可以从一处困惑的页面、一段缺少说明的启动步骤，或一个能复现的小问题开始。

- 使用者与社区组织者：分享真实场景、协作痛点与值得沉淀的知识。
- 设计与内容贡献者：改善移动体验、可访问性、文案、文档和英文翻译。
- 开发者：修复问题、补充权限边界测试、优化导航与性能、完善部署与适配。

欢迎查看 [Issues](https://github.com/fnb666888/umeet-public/issues)，或直接提出建议。大功能先讨论问题与范围，小修复可直接发 PR。步骤见 [CONTRIBUTING.md](CONTRIBUTING.md)。

优先欢迎：启动体验、账号与权限边界、知识协作、移动端与可访问性，以及经过验证的部署文档。这些是共建方向，并非交付时间承诺。

## 检查与测试

在 `rebuild/` 执行 `npm run check`、`npm run build:api` 和 `npm run build:web`。API 集成测试需要独立本地 MySQL 测试库，默认连接 `127.0.0.1:19316/umeet_rebuild_test`；可通过 `TEST_MYSQL_URL` 指定符合安全校验的测试库，勿使用生产数据。更多说明见 [rebuild/README.md](rebuild/README.md)。

## 公开源码与许可证

此仓库从脱敏快照开始，不含原私有仓库历史、生产凭据、运行数据和截图。域名、AppID 和资源标识为示例值；生产 Secrets 与发布开关未迁移。

原创代码采用 [0BSD](LICENSE)：允许使用、修改、分发和商业使用，不要求署名或公开修改后的源码。第三方依赖与资源遵循各自许可证，已有 Lucide 许可证文件保留。原创贡献采用相同许可证。
