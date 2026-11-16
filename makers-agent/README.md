# Umeet Makers 预测 Agent

独立部署到 EdgeOne Makers，主站继续运行在阿里云。LangGraph 固定单节点分析，仅使用调用方提供的证据，不联网、不读数据库、不自动发布。

## 环境

`.env.example` 声明网关变量，由 Makers CLI 在部署时配置。`AI_GATEWAY_MODEL` 必须从账号实际可用模型中选择。`UMEET_AGENT_TOKEN` 使用随机生成的服务端共享密钥，在 Makers 和 ECS 后端分别保存，不能放进浏览器或 Git。

## 接口

POST `/forecast`，请求头 `Authorization: Bearer <shared secret>`、`makers-conversation-id: <unique task UUID>`、`Content-Type: application/json`。请求体：

```json
{"question":"目标项目会在截止日前发布稳定版吗？","rules":"以项目官方 Releases 为准，预发布不算。","informationAt":"2026-11-15T00:00:00Z","evidence":[{"id":"release-1","title":"版本计划","url":"https://example.com/releases","excerpt":"这里放实际采集的证据文本。","fetchedAt":"2026-11-14T23:00:00Z"}]}
```

响应为 SSE：`ping` 心跳、`ai_response.content`（已校验 JSON 字符串）或 `error_message`，正常结束为 `data: [DONE]`。输出包含 probability、reasoning、counterEvidence、evidenceIds。只有收到完整结束标记且没有 error_message，才可使用结果；输出还需由主站业务层核验。每次任务只调用一次模型，关闭自动重试，40 秒执行预算。

现有 `freeProvider` 使用 OpenAI JSON envelope，不能直接把 `INTEREST_AI_URL` 换成本接口；需增加 SSE provider 适配后接入。创建本项目不会启用线上自动预测。

## 验证与部署

`npm install` → `npm run check` → `npm test`。使用 `PAGES_SOURCE=skills`，通过 `edgeone makers dev --skip-env-sync` 本地预览；通过 `edgeone makers build` 检查完整打包。登录后确认工作空间，创建并关联项目，再设置模型名和共享密钥后部署。不得匿名部署 AI 项目。

实际模型调用与可用额度需要账号授权后验证；Makers 内置模型的生产使用条款尚需重新确认。在确认前保持联调用途，不开启公开自动发布。

## 当前验证状态（2026-11-15）

已在用户确认的免费工作空间 default-pages-zone 创建并关联 umeet-forecast-agent。类型检查和 6 项测试通过。CLI 1.7.2 的 makers build 与 makers dev 均在 agent-node Observability: langchain 阶段退出，退出码 1，无可见错误说明。尚未完成部署、本地预览或真实模型调用。模型名及远端共享密钥尚未配置。
