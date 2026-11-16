# 微信开发者工具本机预览

更新：已按用户后续指令上传正式域名配置的 0.1.1，当前源码 API_BASE 为 `https://example.com/api/v1`。下文保留此前本机预览配置，恢复本机联调时需切回本机接口地址；上传状态见 [UPLOAD-0.1.1.md](UPLOAD-0.1.1.md)。

2026-10-11，按用户要求停止真机和 Tailscale 联调，仅在本机开发者工具预览。

## 当前配置

- 工程：`/path/to/project`，`miniprogramRoot=dist/`。
- 小程序服务地址：`http://127.0.0.1:3101/api/v1`。
- 后端 HOST 为 `127.0.0.1`；微信 AppID/AppSecret 保留，演示入口关闭。
- 本地 `project.private.config.json` 的 `setting.urlCheck=false`。
- 运营后台：`http://127.0.0.1:5173/`；代理自动读取根 `.env` 的 HOST/PORT。

## 启动和预览

在项目根目录执行 `npm run dev`，然后在微信开发者工具打开上述工程，点击“编译”。代码编辑后小程序构建监听会更新 dist。当前 API、后台和开发者工具已启动。

进入“我的”点击微信登录即可使用真实微信账号。新账号需要校园认证后才能发帖；认证和内容审核使用运营后台，密码为本地 `.env` 的 ADMIN_PASSWORD。

## 已检查

- 小程序 TypeScript 构建与 10 页资源/事件检查通过。
- 本机 API 和后台代理健康检查成功，demo=false。
- 清除模拟器旧登录状态后，实际点击微信登录，logged=true，显示“新同学”。
- 网络错误分支检查覆盖域名限制、请求超时、401 会话失效与正常响应；诊断不包含授权令牌。

此前手机预览码属于历史产物。原防火墙规则只匹配此前 Tailscale 接口，当前服务只在回环地址监听。若要清理该规则，可在管理员 PowerShell 执行 `scripts/phone-firewall.ps1 -Remove`。
