import { reportReasons } from './report-reasons.js';
import { SiteSettingsSchema } from './site-settings.js';

export const defaultSiteSettings = SiteSettingsSchema.parse({
  site: { title: 'Umeet', description: '', logo: '', feedback: '' },
  boards: {
    daily: {
      description: '今天的校园，发生了什么',
      rules: ['分享校园里的见闻、照片或小故事。', '发照片前留意画面里的同学和个人信息。'],
      prompt: '',
    },
    questions: {
      description: '一个问题，很多种善意的答案',
      rules: [
        '标题写清问题，正文补上地点、时间和已试过的方法。',
        '找到答案后，可以采纳回复或追加进展。',
      ],
      prompt: '',
    },
    market: {
      description: '让闲置走进下一段校园生活',
      rules: ['写明物品成色、价格和校内交接地点。', '当面验货再付款，成交后标记已出。'],
      prompt: '',
    },
    treehole: {
      description: '说出没说出口的话',
      rules: ['聊聊自己的经历和感受。', '尊重他人，省略可识别他人的细节。'],
      prompt: '',
    },
    buddies: {
      description: '约饭、约球、约自习',
      rules: ['写明活动时间、集合地点和参与条件。', '有变更时可以在原帖追加进展。'],
      prompt: '',
    },
    resources: {
      description: '笔记、真题、网盘，一起攒',
      rules: ['附上资料来源、适用课程或使用说明。', '原创作品可以选择「校园作品」，补充体验方式。'],
      prompt: '',
    },
  },
  announcements: [],
  reportReasons: Object.entries(reportReasons).map(([id, label]) => ({
    id,
    label,
    enabled: true,
    boards: [],
  })),
});
