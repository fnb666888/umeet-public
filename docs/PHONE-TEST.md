# Android 真机验证历史记录（已停止）

用户已于 2026-10-11 明确取消真机与 Tailscale 测试。当前只使用微信开发者工具模拟器：API_BASE、HOST 与 PUBLIC_API_URL 已恢复为 `127.0.0.1:3101`，API 和后台已重启。以下为此前联调历史，不作为当前操作步骤。当前说明见 [WECHAT-PREVIEW.md](WECHAT-PREVIEW.md)。

2026-10-11，本次使用真实 AppID。AppSecret 仅保存在根目录被 Git 忽略的 `.env`，上传私钥和开发者工具个人配置也已忽略。

## 当前已验证

- 微信凭据接口返回成功；未输出访问令牌。
- 微信开发者工具 2.02.2608080、基础库 3.17.3：10 个页面及帖子卡片 WXML、全局 WXSS 编译通过。
- 模拟器实际显示社区列表；点击微信登录后 `logged=true`，显示“新同学”。此处使用真实 `wx.login` 和后端 `jscode2session`，不是演示账号。
- 小程序预览包生成成功：总计 82,384 字节，主包 44,284 字节，分包 38,100 字节。
- 小程序构建及资源检查、后台类型检查及构建通过。
- 电脑访问 API 与管理后台代理健康检查成功，返回 `demo=false`。演示登录已关闭。

以上不等于手机验证通过。用户使用 Android，首次手机浏览器访问健康检查失败；Windows 拒绝读取和修改防火墙规则，尚需管理员配置并复测。电脑当前连接 UCAS Wi-Fi，是否存在客户端隔离仍待确认。

## Tailscale 联调更新

用户使用 Tailscale 连接 Android 设备。2026-10-11 更新检查：电脑当前 Tailscale IPv4 为 `192.0.2.10`，Android 设备为 `192.0.2.20`；Tailscale ping 经中继成功。旧预览包使用 Wi-Fi IP 且后端只绑定 Wi-Fi IP，不能直接通过本次 Tailscale 地址访问。

现已同步 `.env` 的 HOST/PUBLIC_API_URL 与小程序 API_BASE，重启 API 和后台。电脑经 Tailscale IP 健康检查与后台代理健康检查返回正常。生成的新预览码为 `artifacts/wechat-preview-tailscale.png`。手机还需开启 Tailscale 连接及小程序调试；扫码后实测仍待确认。

防火墙脚本在 Tailscale 模式下只允许 `.env` 中 PHONE_TEST_REMOTE_IP 指定的 Android 地址访问当前 API 端口，不扩大到整个 Tailscale 地址段。

已由管理员执行脚本，并通过 `netsh advfirewall firewall show rule name="Umeet phone verification (LAN only)" verbose` 核对：规则启用，入站 TCP 3101，本机 `192.0.2.10`，远端仅 `192.0.2.20`，Action=Allow。`netsh` 的 name 参数匹配显示名称，不能用 PowerShell 的内部规则名 `Umeet-Phone-Test` 查询。

新版登录连接失败会显示微信原始错误和服务地址；区分合法域名限制、请求超时和其他连接失败。请求分支检查覆盖域名失败、超时、401 会话撤销、正常返回，并确认诊断信息不含授权令牌。

## 本次地址和运行

API：`http://192.0.2.10:3101/api/v1`。3100 端口在本机绑定时返回 EACCES，改用已成功监听的 3101。

启动 API 和后台：分别在项目根目录的两个终端执行：

```powershell
npm run start -w @umeet/api
npm run dev -w @umeet/admin
```

后台：`http://127.0.0.1:5173/`，管理员密码读取本地 `.env` 的 ADMIN_PASSWORD。后台开发代理自动读取根目录 HOST/PORT。

## 手机连通和扫码

1. 手机与电脑连接同一 Tailscale 网络；手机浏览器访问 `http://192.0.2.10:3101/api/v1/health`，应返回 `status=ok`。
2. 如果打不开，以管理员身份打开 PowerShell，运行下面的脚本，再次测试。脚本只允许本机配置的 API 地址和端口，远端限制为 LocalSubnet，不关闭防火墙。

   ```powershell
   & '/path/to/project'
   ```

3. 如果放行后仍打不开，检查手机是否同一 Wi-Fi，并用手机热点连接电脑测试设备隔离。网络切换后电脑 IP 会改变，需要更新根 `.env` 的 HOST/PUBLIC_API_URL 与小程序 `src/config.ts` 的 API_BASE，重启 API 和后台、重建小程序并重新生成预览码。
4. 用具有本 AppID 开发者权限的微信扫描开发者工具预览码。当前二维码文件为 `artifacts/wechat-preview.png`，失效后在开发者工具重新预览。
5. 若手机提示合法域名校验失败，开启小程序调试模式后重新进入。电脑的 `project.private.config.json` 已关闭开发期域名校验；手机需要单独处理。正式版本应使用配置过合法域名的 HTTPS 服务。

## 验证顺序

| 操作             | 预期                                     | 当前手机结果                   |
| ---------------- | ---------------------------------------- | ------------------------------ |
| 浏览器健康检查   | status=ok                                | 首次失败，等待防火墙配置后复测 |
| 扫码进入社区     | 正常显示列表和四个导航页                 | 待测                           |
| 我的 → 微信登录  | 登录成功；未认证不获得发帖权限           | 待测                           |
| 学校认证         | 选择学校，提交专门准备的测试材料进入待审 | 待测                           |
| 后台认证审核     | 管理员审核后，同校权限生效               | 待测                           |
| 发帖、上传图片   | 发布后待审核；不会立即公开               | 待测                           |
| 后台内容审核     | 审核后列表可见，图片加载成功             | 待测                           |
| 点赞、收藏、评论 | 状态正确；评论经过审核                   | 待测                           |
| 通知、搜索、分享 | 站内通知和页面跳转正常                   | 待测                           |

本次不需要再提供 AppSecret 或上传私钥。订阅消息测试还需要后台配置模板 ID 和字段映射；尚未配置，先验证站内通知。

测试结束可以移除此次防火墙规则：

```powershell
& '/path/to/project' -Remove
```
