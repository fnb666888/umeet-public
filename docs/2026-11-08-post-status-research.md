# 帖子状态调研与 Umeet 建议

调研日期：2026-11-08。此次为研究与建议，未修改 demo 状态样式。依据为下列公开官方页面；配色数值是 Umeet 的建议值，并非各社区原始色值。

## 社区做法

| 社区 | 官方说明中核实的做法 | 对 Umeet 的启示 |
| --- | --- | --- |
| Discourse Solved | 已解决显示勾选框；可开启未解决的空复选框；支持解决状态筛选；采纳答案在首帖中高亮 | 位置和图形保持一致，已解决应能关联到答案 |
| Stack Overflow | 由提问者采纳的回答旁显示彩色勾号；采纳表示该回答对提问者有效，不代表绝对正确 | 不以回复数量推断解决状态，状态应由采纳驱动 |
| GitHub Discussions | 问答分类中可将评论标记为答案；分类、标签、关闭讨论分别管理；标签也可用于表达状态 | 已回答与已关闭是不同维度；状态不应混同板块和主题标签 |
| Reddit Post Flair | 社区自定义 Flair，可设置文字、表情、背景和文字颜色；可通过 Flair 筛选内容 | 学习小面积、可识别的标记形式；Flair 本身并非全站统一的解决状态 |

## 当前 demo 问题

`demo/web-ux/css/style.css` 中 `.question-status` 与 `.market-status` 被设置为透明底、无内边距、灰色文字；`.question-status.solved` 同样是灰色。已解决和待解答主要依赖小图形区分，扫描列表时不明显。现有结构已把状态放在标题旁，板块和标签在下一行，建议沿用此位置。

## 建议

采用统一的小状态徽标：图标、明确文字、浅色背景和细描边，12px 中等字重，左右 6–8px 内边距，4–6px 圆角；不把整行或标题染色，不增加阴影或动画。保留标题正常字重、悬浮加粗。

| 状态 | 建议表达 | 前景 / 背景 / 描边 |
| --- | --- | --- |
| 已解决 | 圆圈勾号＋已解决 | #166534 / #F0FDF4 / #BBF7D0 |
| 待解答 | 时钟或空心圆＋待解答 | #92400E / #FFFBEB / #FDE68A |
| 在售 | 小圆点＋在售 | #2854B0 / #EFF4FF / #CBD9FA |
| 已出 | 圆圈勾号或横线＋已出 | #526071 / #F1F3F5 / #DCE1E7 |

颜色是辅助：黑白或色觉差异下仍能通过图标和文字判断。不使用红色表示普通待处理状态。主操作与板块链接继续使用原有 #3568D4 蓝色。

列表每帖最多显示一个主要业务状态，在标题末尾整体换行，不能拆开图标和文字；卡片和详情页复用同一种语义样式。板块使用蓝色图标文字链接，主题标签保留浅灰无描边；状态才使用带描边的语义色徽标。普通讨论无需显示“讨论中”。“校园作品”是内容类型，不是流程状态。

现有 `isSolved` 从 `S.best` 的采纳记录判定，值得保留；有回复但没有采纳时仍为“待解答”，不改成“无人回答”。已出仍然可阅读原帖，不等同删除或关闭评论。活动尚未建立招募/截止状态数据，不建议为了视觉增加虚构状态。

## 来源

- Discourse Solved：https://meta.discourse.org/t/discourse-solved/30155
- Stack Overflow accepted answer：https://stackoverflow.com/help/accepted-answer
- GitHub About discussions：https://docs.github.com/en/discussions/collaborating-with-your-community-using-discussions/about-discussions
- GitHub Managing discussions：https://docs.github.com/en/discussions/managing-discussions-for-your-community/managing-discussions
- Reddit Post Flair：https://support.reddithelp.com/hc/en-us/articles/15484545678996-Post-Flair
