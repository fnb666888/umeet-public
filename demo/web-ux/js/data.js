/* mock 数据 */
const NOW = Date.now();
const H = h => NOW - h * 3600e3;

const communities = [
  { slug:'daily',    name:'校园日常', desc:'今天的校园，发生了什么' },
  { slug:'questions',name:'问答求助', desc:'一个问题，很多种善意的答案' },
  { slug:'market',   name:'二手交易', desc:'让闲置走进下一段校园生活' },
  { slug:'treehole', name:'树洞',     desc:'说出没说出口的话' },
  { slug:'buddies',  name:'搭子活动', desc:'约饭、约球、约自习' },
  { slug:'resources',name:'资源共享', desc:'笔记、真题、网盘，一起攒' },
];

const posts = [
  {
    id:'p1', community:'questions', author:'陈小满', hoursAgo:5, likes:12,
    title:'图书馆哪层插座最多？赶 ddl 求稳',
    excerpt:'期末周找插座堪比寻宝。有没有人统计过各层插座分布？想找个能从早坐到晚的位置。',
    body:'期末周找插座堪比寻宝。有没有人统计过各层插座分布？\n\n本人需求：靠窗、有插座、能从早坐到晚，噪音小。听说三楼西南角有一片插座位？求坐标。',
    wikiRef:{id:'w1', section:'outlets'},
  },
  {
    id:'p2', community:'daily', author:'一只银杏', hoursAgo:26, likes:38,
    title:'图书馆前那棵银杏黄了，猫也换上冬毛了',
    excerpt:'今天路过拍了两张，猫在落叶堆里打滚，特别治愈。大家最近拍到什么好照片？',
    body:'今天路过拍了两张，猫在落叶堆里打滚，特别治愈。\n\n听说这棵银杏是建校那年种的，比我们爷爷年纪还大。大家最近拍到什么好照片，欢迎楼里盖楼晒图。',
  },
  {
    id:'p3', community:'market', author:'毕业学长K', hoursAgo:9, likes:6, price:'¥2699',
    title:'出 95 新 iPad Air 5（64G 蓝色），毕业甩卖',
    excerpt:'自用两年，一直贴膜带壳，电池效率 89%。毕业清仓，可小刀，面交东门。',
    body:'自用两年，一直贴膜带壳，电池效率 89%，无磕碰无进水。\n\n带原装充电器 + 一个新保护壳。毕业清仓 ¥2699 可小刀，面交东门快递柜旁，可验机。',
  },
  {
    id:'p4', community:'treehole', author:'夜猫同学', hoursAgo:2, likes:156,
    title:'三点半的食堂夜宵窗口，阿姨会多给一勺',
    excerpt:'实验做到三点半去吃夜宵，阿姨看我一眼说"又熬夜了？多吃点"。突然就被治愈了。',
    body:'实验做到三点半去吃夜宵，阿姨看我一眼说"又熬夜了？多吃点"。\n\n突然就被治愈了。这座城市里认真生活的人，都在互相托举着。',
  },
  {
    id:'p5', community:'buddies', author:'跑步机上的鱼', hoursAgo:14, likes:9,
    title:'周六岳麓山徒步，还差 2 人，早八点东门集合',
    excerpt:'路线：东门→爱晚亭→山顶观景台，约 4 小时，难度不大。带水和零食即可。',
    body:'路线：东门→爱晚亭→山顶观景台，约 4 小时，难度不大。\n\n集合：周六早八点东门。带水和零食即可，下雨顺延一周。评论区扣 1 报名。',
  },
  {
    id:'p6', community:'resources', author:'笔记侠', hoursAgo:40, likes:21,
    title:'高数期末真题打包（近 5 年 + 手写解析）',
    excerpt:'网盘链接在评论区，手写解析是我自己整理的，包含错题批注。祝大家期末顺利！',
    body:'网盘链接在评论区，手写解析是我自己整理的，包含错题批注。\n\n覆盖近 5 年期末卷，解析按考点分类。自取即可，祝大家期末顺利！',
  },
];

/* 评论：parentId 树，最多两级渲染 */
const comments = {
  p1: [
    { id:'c1', author:'三楼钉子户', hoursAgo:4, likes:9, body:'三楼西南角有一片 24 个插座位，人最少。二楼靠窗好看但插座少，四楼安静但没窗。' },
    { id:'c2', parentId:'c1', author:'陈小满', hoursAgo:3, likes:2, body:'太感谢了！明天就去占领。' },
    { id:'c3', parentId:'c1', author:'泡面加蛋', hoursAgo:3, likes:1, body:'补充：那排插座有的松，带个转换头保险。' },
    { id:'c4', parentId:'c1', author:'泡面加蛋', hoursAgo:3, likes:0, body:'再补充：周五下午有人打扫，位置会被收走。' },
    { id:'c5', author:'图书馆管理员', hoursAgo:2, likes:14, body:'官方回复：各层插座地图贴在一楼公告栏了，也可以在 Wiki「图书馆完全攻略」里看到实时更新。' },
    { id:'c6', parentId:'c5', author:'陈小满', hoursAgo:1, likes:1, body:'原来有官方地图！感谢！' },
  ],
  p2: [
    { id:'c1', author:'爱拍照的鹿', hoursAgo:20, likes:5, body:'拍到同款！它好像对落叶有执念。' },
    { id:'c2', author:'树洞潜水员', hoursAgo:18, likes:2, body:'这猫叫"馆长"，馆里人都在喂它。' },
  ],
  p3: [
    { id:'c1', author:'想买平板的人', hoursAgo:8, likes:0, body:'已私信，明天下午面交可以吗？' },
    { id:'c2', parentId:'c1', author:'毕业学长K', hoursAgo:7, likes:0, body:'可以，东门快递柜旁见。' },
  ],
  p4: [],
  p5: [
    { id:'c1', author:'爬山搭子', hoursAgo:12, likes:3, body:'扣 1！带摄像头的。' },
  ],
  p6: [],
  p9: [
    { id:'c1', author:'一只银杏', hoursAgo:7, likes:2, body:'先在微信的校园一卡通小程序挂失，再带学生证去行政楼 108 补办。' },
    { id:'c2', author:'笔记侠', hoursAgo:5, likes:1, body:'补卡前可以在小程序里查余额。线上挂失、线下补办的步骤也整理在校园卡 Wiki 里。' },
  ],
};

const wiki = [
  {
    id:'w1', slug:'library', title:'图书馆完全攻略', updated:'2 小时前', editor:'三楼钉子户', communities:['questions', 'resources'],
    revisions:12, words:2140,
    summary:'开放时间、借书规则、自习室对比与插座地图，全在这一个词条里。',
    sections:[
      { h:'开放时间', p:'主馆周一至周日 7:00–22:30，考试周延长至 23:30。法定节假日 9:00 开馆，具体以馆内公告为准。' },
      { h:'借书规则', p:'本科生一次可借 10 本，期限 30 天，可续借 1 次。超期 0.1 元/天/本，务必在"我的图书馆"里及时续借。' },
      { h:'自习室怎么选', p:'二楼靠窗采光好但插座少；三楼西南角是插座位集中区（24 个座位）；四楼最安静，适合深度学习；五楼研讨间需提前一天预约。' },
      { id:'outlets', h:'插座地图', p:'一楼大厅电子屏有实时插座占用图。三楼西南角 24 个、二楼东侧 8 个、四楼北侧 12 个。带转换头更保险——部分插座偏松。' },
      { h:'常见问题', p:'丢书怎么办：到总服务台按原价 1.5 倍赔付并加 5 元工本费。占座规则：离开 30 分钟以上需带走个人物品。' },
    ],
  },
  {
    id:'w2', slug:'course-select', title:'选课生存指南', updated:'1 天前', editor:'笔记侠', communities:['questions', 'resources'],
    revisions:8, words:1860,
    summary:'抢课时间表、退改规则和往届学长学姐的课程红黑榜入口。',
    sections:[
      { h:'抢课时间表', p:'每学期第 16 周周三 12:00 开放第一轮选课。第一轮抽签制不拼手速，第二轮先到先得，记得定好闹钟。' },
      { h:'退改规则', p:'开课两周内可无理由退课；两周后退课记 W，影响绩点不计。每学期最多退 2 门。' },
      { h:'课程评价入口', p:'往届评价已迁移到 Wiki「课程红黑榜」词条，按学院分类，匿名投稿。' },
    ],
  },
  {
    id:'w3', slug:'campus-card', title:'校园卡充值与挂失', updated:'3 天前', editor:'一只银杏', communities:['questions', 'daily'],
    revisions:5, words:640,
    summary:'线上充值入口、线下网点位置，以及卡丢了之后每一步该做什么。',
    sections:[
      { h:'线上充值', p:'微信搜索"校园一卡通"小程序，绑定学号后可直接充值，到账约 1 分钟。' },
      { h:'挂失流程', p:'① 小程序一键挂失 → ② 带学生证到卡务中心（行政楼 108）补办 → ③ 交 15 元工本费，当场拿卡，余额自动转移。' },
    ],
  },
  {
    id:'w4', slug:'canteen', title:'食堂红黑榜', updated:'5 天前', editor:'泡面加蛋', communities:['daily'],
    revisions:23, words:3080,
    summary:'一食堂到四食堂的窗口实测，谁家糖醋排骨值得排队，谁家慎点。',
    sections:[
      { h:'一食堂', p:'二楼 8 号窗口的糖醋排骨是镇店之宝，11:20 前去不用排队。一楼面食窗口晚高峰排队久，错峰去。' },
      { h:'三食堂', p:'性价比之王，6 元两荤一素。但麻辣香锅口味不稳定，看运气。' },
      { h:'夜宵窗口', p:'三点半的夜宵窗口阿姨会多给一勺——这是全校公认的温度。' },
    ],
  },
];

const notifications = [
  { id:'n1', icon:'likes', text:'一只银杏、泡面加蛋 和另外 5 人赞了你的帖子', detail:'「期末周找插座…」', hoursAgo:1, href:'#/posts/p1' },
  { id:'n2', icon:'reply', text:'三楼钉子户 回复了你', detail:'三楼西南角有一片 24 个插座位…', hoursAgo:4, href:'#/posts/p1#cm-c1' },
  { id:'n3', icon:'wiki', text:'Wiki「图书馆完全攻略」被编辑了', detail:'三楼钉子户 更新了插座地图', hoursAgo:2, href:'#/wiki/w1' },
  { id:'n4', icon:'reply', text:'毕业学长K 回复了你的评论', detail:'可以，东门快递柜旁见。', hoursAgo:7, href:'#/posts/p3#cm-c2' },
  { id:'n5', icon:'system', text:'你发布的帖子已通过审核', detail:'「周六岳麓山徒步…」', hoursAgo:13, href:'#/posts/p5' },
];

/* —— 个人中心 mock：我的帖子直接进 posts 流 —— */
posts.push(
  {
    id:'p7', community:'daily', author:'林同学', hoursAgo:30, likes:3,
    title:'社团招新摆摊的位置怎么申请？有人知道流程吗',
    excerpt:'想帮社团问一下，下学期招新摆摊要找哪个部门申请？需要带什么材料？',
    body:'想帮社团问一下，下学期招新摆摊要找哪个部门申请？需要带什么材料？\n\n问了一圈没问到，来社区求助。',
  },
  {
    id:'p8', community:'buddies', author:'林同学', hoursAgo:52, likes:5,
    title:'周六晚找人拼《流浪地球3》 IMAX 票',
    excerpt:'两人起拼，票价 42/人。七点半场，市区万达，可以一起吃个晚饭再进场。',
    body:'两人起拼，票价 42/人。\n\n七点半场，市区万达。可以一起吃个晚饭再进场，看完一起吐槽。',
  },
  {
    id:'p9', community:'questions', author:'林同学', hoursAgo:9, likes:0,
    title:'校园卡丢了，怎么挂失和补办？',
    body:'校园卡今天找不到了。想先线上挂失，再去补一张，需要带什么证件？',
    wikiRef:{id:'w3'},
  },
);

const profileReplies = [
  { post:'图书馆哪层插座最多？赶 ddl 求稳', pid:'p1', snippet:'三楼那排插座确实松，带个转换头保险。', hoursAgo:20 },
  { post:'图书馆前那棵银杏黄了，猫也换上冬毛了', pid:'p2', snippet:'上周喂过它一根火腿肠，它记得我。', hoursAgo:26 },
  { post:'高数期末真题打包（近 5 年 + 手写解析）', pid:'p6', snippet:'解析太强了，已收藏，感谢分享！', hoursAgo:44 },
];
const bookmarkedIds = ['p1', 'p6'];

/* —— 个人资料与账号 mock —— */
const profile = {
  name:'林同学', avatar:'', bio:'大四 · 搬砖中。回答校园生活的一切问题。',
  school:'湖南大学', campus:'校本部', dept:'计算机科学与技术', year:'2023 级',
  tags:['跑步','摄影','Vim','猫'],
};
const loginDevices = [
  { name:'MacBook Pro · Chrome', meta:'上海 · 当前会话', current:true },
  { name:'iPhone 15 · 微信小程序', meta:'长沙 · 昨天 22:41', current:false },
  { name:'图书馆三楼 · Windows · Edge', meta:'长沙 · 3 天前', current:false },
];
const notifPrefs = { reply:true, like:true, follow:true, system:false };
const privacyPrefs = { profilePublic:true, marksPublic:false };

/* —— 标签 mock —— */
const TAG_POOL = ['期末周','图书馆','考研','租房','二手','数码','社团','实习','徒步','搭子','电影','摄影','校园日常','美食','失物招领','自习室'];
const POST_TAGS = {
  p1:['期末周','图书馆','自习室'],
  p2:['摄影','校园日常'],
  p3:['二手','数码'],
  p5:['徒步','搭子'],
  p6:['期末周','考研'],
  p7:['社团'],
  p8:['电影','搭子'],
};
posts.forEach(p => { p.tags = POST_TAGS[p.id] || []; });

for (const [id, hour, minute, meeting] of [['p5',8,0,'东门集合'], ['p8',19,30,'市区万达']]){
  const date = new Date(NOW);
  date.setDate(date.getDate() + (6 - date.getDay() + 7) % 7);
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= NOW) date.setDate(date.getDate() + 7);
  Object.assign(posts.find(post => post.id === id), {meetingAt:date.getTime(), meeting});
}
