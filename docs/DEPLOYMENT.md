# 配置与部署

## 本地开发

按 README 执行 npm ci、npm run setup、npm run dev。开发 PostgreSQL 监听 127.0.0.1:55432；测试数据库使用 55433。不要将开发演示接口直接公开到互联网。

已有 PostgreSQL 时，将 LOCAL_DATABASE=false，并修改 DATABASE_URL；先执行 npm run migrate -w @umeet/api，再启动服务。生产不会自动执行迁移，避免多实例启动时修改数据库。

## 生产配置

复制 .env.production.example 到 .env.production，填入自己的服务配置。该文件被版本控制忽略；Docker 构建上下文不会包含任何 .env 文件。

| 配置                                                | 用途                                              |
| --------------------------------------------------- | ------------------------------------------------- |
| POSTGRES_PASSWORD、REDIS_PASSWORD                   | 随机强密码；compose 中建议用十六进制避免 URL 转义 |
| JWT_SECRET                                          | 至少 40 字符的独立随机密钥                        |
| ADMIN_PASSWORD                                      | 至少 20 字符的随机管理员密码                      |
| WECHAT_APP_ID / WECHAT_APP_SECRET                   | 真实微信小程序服务端凭据                          |
| PUBLIC_API_URL / CORS_ORIGINS                       | 正式 HTTPS 域名及允许的后台来源                   |
| S3_ENDPOINT、REGION、BUCKET、ACCESS_KEY、SECRET_KEY | 私有对象存储，凭据仅授予所需桶的读写删除能力      |
| SMTP_*                                              | 可选；未配置邮件时使用人工材料认证                |
| WECHAT_SUBSCRIBE_TEMPLATE / FIELD_MAP               | 可选；实际申请的模板及字段映射                    |
| VERIFICATION_RETENTION_DAYS                         | 人工审核材料处理后保留天数，默认 7 天             |

订阅字段映射形如 {"title":"thing1","body":"thing2","time":"time3"}，必须与实际模板一致。授权不代表平台保证发送成功，学生始终可在站内查看结果，后台可查看外发状态。文本字段截断为 20 个字符；模板具体字段类型与平台限制须用真实账号核验。

生产启动会拒绝演示模式、开发内嵌数据库、弱密钥、缺少 Redis/微信/对象存储配置及非 HTTPS 的 PUBLIC_API_URL。不要把 AppSecret 放进小程序代码。

## 容器部署

需要 Docker Engine 与 Compose v2。项目提供 PostgreSQL、Redis、迁移任务、API、Worker 和 Nginx；本机未安装 Docker，此配置未实际运行验证。

```sh
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production up --build -d
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=100 api worker migrate
```

迁移容器成功后才启动 API 和 Worker。Nginx 默认只映射主机 127.0.0.1:8080，不直接暴露数据库或 Redis。正式域名的 HTTPS 终止由部署平台或外层反向代理配置；此仓库不包含证书和域名申请。

若外层代理转发客户端 IP，需在 Nginx 中按该可信代理的实际地址配置 real_ip_header / set_real_ip_from，然后使用其解析的 remote_addr 传给 API。后端 TRUST_PROXY=1 只适合 API 前有一个可信、不可绕过的代理的拓扑，需与实际部署匹配，否则限流可能把多个用户视为同一地址。

PostgreSQL 18 的卷挂载使用 /var/lib/postgresql。数据库与 Redis 使用命名卷；不要使用 down -v 删除生产数据。滚动升级前备份数据库和对象存储，测试迁移；不自动回滚迁移。

如直接部署进程，依次执行 npm ci、npm run build、npm run migrate -w @umeet/api，再分别运行 API 与 worker 脚本，用进程管理器维护。API 与 Worker 使用同一套生产环境变量。

## 微信账号接入

1. 在 project.config.json 设置真实 AppID；src/config.ts 设置正式 HTTPS API 基地址，执行小程序构建。
2. 在微信管理平台配置请求、上传、下载合法域名。私有 S3 短期链接发生跳转，对象存储域名也需符合下载要求；网页预览使用跨域读取时配置桶 CORS。
3. 后台添加真实学校与校区、认证邮箱域名。公开学校标识与校区标识，学生据此选择并申请认证。
4. 用真实账号核验微信登录、认证、图文审核、分享、订阅授权与发送；需复核当前平台规则和基础库支持。
5. 安排人工内容审核和举报处理，完成运营主体、隐私政策、认证材料保留期与客服联系渠道，再提交体验版/平台审核。

开发版隐私说明不能直接作为正式运营的完整隐私政策。

## 运维与恢复

- API 健康接口为 /api/v1/health；生产依赖 Redis 限流，Redis 故障时请求会返回服务暂不可用。
- 后台“任务状态”显示失败/待办事件，可重试明确失败的内部任务；订阅 UNKNOWN 不自动重发。
- Worker 执行材料清理并输出失败日志，应同时监控 Worker 进程、待审积压、失败事件、发送结果和数据库容量。
- 建立 PostgreSQL 定期备份、对象存储保护与备份恢复演练；软删除、审计与备份的保留期由实际运营政策确定。
- 首期列表有条数上限，正式扩大使用范围前应补充分页和负载测试。
