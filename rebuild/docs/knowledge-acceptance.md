# 新 Wiki 实施与验收记录

日期：2026-11-12。范围：本地实现与隔离环境验收，未部署线上，未搬运或删除已有 Wiki 内容。

## 已交付能力

- 全站共享词条：独立于社区存续，支持同名限定、别名检索、稳定链接、历史、差异与生成新版本的回退。
- 统一编辑：普通词条／指导手册／学科知识模板，可视化与源码、公式和预览、正文引用、正文目录、独立反链与四种知识关系。
- 发布与协作：普通成员先审核，管理人员可治理全站正文；退回重提、候选稿隐私、原贡献者记录、幂等与并发冲突检查。
- 私人草稿：服务端自动保存、跨刷新／登录／设备恢复，明确失败与重试，多设备冲突可对照、另存；账号绑定拒绝串号保存。
- 社区组织：共享收录、分层目录、多处引用与独立排序，普通成员提建议，由对应社区的有效 Wiki 管理人员审核。
- 学习路线：独立目标、步骤、导读，跟随最新发布版；按修订判断待复核，提醒持久化、重试去重，不发送已过期或已完成复核的提醒。
- 治理：争议登记与暂停分开，全站管理员暂停／恢复、记录依据后复核发布；隐藏恢复、全站管理员永久清除、引用不可用提示。
- 页面与入口：社区主导航、社区 Wiki 按钮、新路由导航和旧管理页入口已接线；保留旧 Wiki 参考内容入口。Wiki 页顶栏搜索定位到新知识库。

## 浏览器场景

使用真实 MySQL、真实会话认证与真实 API，经 Edge／Playwright 执行，未模拟业务请求。`tests/web/knowledge.py` 在专用的 `umeet_rebuild_test_knowledgebrowser` 库中重建可丢弃夹具；正常使用的数据与旧业务库不在该脚本范围内。

| 场景 | 结果与证据 |
| --- | --- |
| 游客阅读 | 全站搜索、物理三个分支、公式、手册四步指南和路线前进均通过 |
| 私人稿件 | 刷新与第二次登录可恢复完整稿；提交前后不向其他普通成员或公共搜索泄露 |
| 审核 | 未收录该词条的社区管理人员退回，作者补充重提后批准；发布版保留原贡献者 |
| 正文纠错 | 登录后可讨论与纠错；访客保持只读 |
| 目录与路线 | 实际操作新增子目录、同词条多处挂载、维护路线目标；普通成员目录建议先不生效，正确社区审核后生效 |
| 并发 | 两窗口使用独立私人草稿编辑同一修订；第二次发布被拒绝，稿件保留，人工合并并确认最新基准后可发布 |
| 路线复核 | 正文更新产生待复核状态；核对后清除当前提示，旧修订不能确认新修订 |
| 争议 | 提争议不冻结；全站管理员暂停后仍接收提案，复核记录依据后可发布 |
| 隐藏恢复 | 公共正文返回不可用，公开历史与反链不返回隐藏内容；恢复后可读 |
| 永久清除 | 未勾选不可恢复确认时按钮禁用；仅用站长权限清除本轮自动创建的临时词条 |
| 入口兼容 | 旧 `/#/wiki` 仍可访问，新主导航指向 `/knowledge` |
| 页面交互 | 桌面与 390 px 手机检查通过，无页面横向溢出，无新增未捕获浏览器错误或非预期控制台错误 |

## 自动检查

专项命令 `npm run test:knowledge`：4 个文件、20 项测试通过，涵盖服务端权限／事务／草稿／组织／治理、草稿交互和安全渲染。最终单独执行 `npm test`：51 个文件、177 项测试全部通过，无跳过用例。类型检查、API 构建与 Web 生产构建通过。

额外浏览器检查：顶栏／URL 参数可搜索新词条，正文目录存在，320／390 px 下无页面横向溢出，暗色阅读已截图核对。旧 Wiki 使用当前实际的 hash 入口验证阅读与主导航；计划中原 `wiki.py` 面向已在前序改动中重定向的另一套页面，本轮未把其过期选择器作为基线，也没有删改该脚本来制造通过。旧服务继续纳入上述全量 API 测试。

并行检查时，默认 19 个页面数据 worker 曾耗尽本机内存，导致构建、浏览器和一次密码派生测试中断。已将 Next 构建 worker 明确限制为 2，并改为串行验收；没有修改密码算法、跳过测试或隐藏内存失败。该配置只限制构建并行度，不改变运行时服务并发。

## 样例与来源

物理样例是按公开教材独立整理的短篇验收内容，覆盖基础／近似／应用三支、四种关系、条件说明与一条路线，不代表完成了整个物理学内容库。

- [波的数学描述](https://openstax.org/books/university-physics-volume-1/pages/16-2-mathematics-of-waves)
- [经典平面电磁波](https://openstax.org/books/university-physics-volume-2/pages/16-2-plane-electromagnetic-waves)
- [几何光学与成像](https://openstax.org/books/university-physics-volume-3/pages/2-introduction)
- [薄透镜](https://openstax.org/books/university-physics-volume-3/pages/2-4-thin-lenses)

校园手册采用有来源的 Windows 校园网通用排查指南，依据 [Microsoft 网络排障说明](https://support.microsoft.com/en-gb/windows/experience/connectivity-networking/fix-wi-fi-connection-issues-in-windows)。没有编造某所学校的认证地址、办理要求或联系方式；实际学校流程可由社区补充资料后建词条。手册只显示最后编辑时间，不增加核实／到期复核字段。

## 实现对应关系

设计文件：[正式方案](../../docs/superpowers/specs/2026-11-12-wiki-knowledge-system-design.md)。计划：[实施计划](../../docs/superpowers/plans/2026-11-12-wiki-knowledge-system.md)。

- 新模块：`apps/api/src/modules/knowledge/`；公开指针、不可变正文修订、待审提案、私人草稿分开。
- 新迁移：`032_knowledge`、`033_knowledge_links`，只创建新 Wiki 表，不改写旧正文。
- 前端：`apps/web/src/components/knowledge/`、`/knowledge`、`/c/[slug]/knowledge`。
- 计划中的多个 API 集成测试按同一真实数据库夹具集中在 `apps/api/test/knowledge.int.test.ts`；并未创建只重复覆盖实现的空测试文件。
- 路线步骤的已确认修订保存在 `knowledge_route_steps.confirmed_revision_id`，作为计划中“路线复核状态”的实现；路线本身另存修订快照。
- 初版用数据库事务中的共享写锁保护发布、图关系与治理，优先保证并发正确性。大规模写入时可按词条／组织拆分锁；当前不把高并发吞吐验收等同于已完成。

## 本地使用与后续发布

当前预览：`http://127.0.0.1:5178/knowledge`。主导航可直接进入。预览使用隔离样例库，测试账号仅保存在被 Git 忽略的 `.runtime/knowledge-fixture.json`，不要把该文件部署或提交。

从 `rebuild/` 执行：

```powershell
# 专用本机 MySQL 需已在回环地址 19316 运行。
npm run fixture:knowledge   # 重置隔离样例库；不会操作旧业务库。
npm run preview:knowledge   # 启动本机 API 3188 与 Web 5178。
npm run test:knowledge
npm run e2e:knowledge       # 会重新建立隔离夹具，清除该测试库中的试用编辑。
```

正式发布时先备份并执行新增迁移，再部署服务与页面；已有内容按确认方案人工整理。当前没有执行云端迁移、部署或公开流量切换。测试样例也没有自动写入正式内容库。

## 截图

- [知识库首页](evidence/knowledge/home-desktop.png)
- [物理词条与关系](evidence/knowledge/physics-desktop.png)
- [校园指南](evidence/knowledge/handbook-desktop.png)
- [手机学习路线](evidence/knowledge/route-mobile.png)
- [手机编辑器](evidence/knowledge/editor-mobile.png)
- [审核界面](evidence/knowledge/review-desktop.png)
- [争议与隐藏管理](evidence/knowledge/governance-desktop.png)
- [暗色手机阅读](evidence/knowledge/physics-dark-mobile.png)
