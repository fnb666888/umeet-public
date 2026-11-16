import type {
  DemoPost,
  DemoReply,
  DemoWiki,
  DemoState,
  DemoOperation,
} from '../../../../../packages/contracts/src/community';
import type { ModerationAccess } from '../../../../../packages/contracts/src/admin';

export type Post = DemoPost & { stars?: number };
export type Reply = DemoReply;
export type Profile = NonNullable<DemoState['profile']>;
export type Operation = DemoOperation;
export type WikiVersion = Pick<
  DemoWiki,
  'title' | 'summary' | 'sections' | 'quick' | 'reference'
> & { table?: DemoWiki['table'] };
export type Wiki = Omit<DemoWiki, 'notes' | 'suggestions' | 'history'> & {
  notes: { id: string; author: string; text: string; at: string }[];
  suggestions: {
    id: string;
    author: string;
    text: string;
    at: string;
    section: string;
    index: number;
    reference: string;
    applied: boolean;
  }[];
  history: {
    hidden?: boolean;
    at: string;
    author: string;
    reason: string;
    before: WikiVersion;
    after: WikiVersion;
  }[];
};
export type Snapshot = {
  partial?: boolean;
  resourcePath?: string;
  page?: {key:string;kind:string;postId:string|null;next:string|null;size:number};
  bootstrap?: boolean;
  boards?: { slug: string; name: string; description: string }[];
  postReviews?: { id: string; board: string; title: string; status: string; reason: string; createdAt: string }[];
  suspended?: boolean;
  tombstones?: { id: string; community: string }[];
  version: number;
  actor: { userId: string; nickname: string; kind: string; platformRoles?: string[]; moderation?: ModerationAccess } | null;
  content: {
    posts: Post[];
    comments: Record<string, Reply[]>;
    wiki: Wiki[];
    notifications: { id: string; text: string; detail: string; href: string; createdAt: number }[];
  };
  userState: DemoState & {
    likes: string[];
    commentLikes: string[];
    best: Record<string, string>;
    threads: {
      peer: string;
      unread: boolean;
      messages: { id: string; text: string; postId?: string; incoming: boolean }[];
    }[];
  };
  contacts: { id: string; name: string }[];
  profiles: { id: string; public: boolean; profile?: Profile; bookmarks?: string[] }[];
};
export const boards: { slug: string; name: string; desc: string; icon: string; moderatorId?: string | null }[] = [
  { slug: 'daily', name: '校园日常', desc: '今天的校园，发生了什么', icon: 'leaf' },
  { slug: 'questions', name: '问答求助', desc: '一个问题，很多种善意的答案', icon: 'circle-help' },
  { slug: 'market', name: '二手交易', desc: '让闲置走进下一段校园生活', icon: 'shopping-bag' },
  { slug: 'treehole', name: '树洞', desc: '说出没说出口的话', icon: 'messages-square' },
  { slug: 'buddies', name: '搭子活动', desc: '约饭、约球、约自习', icon: 'users' },
  { slug: 'resources', name: '资源共享', desc: '笔记、真题、网盘，一起攒', icon: 'folder-open' },
];
export type Board = string;
export function updateBoardDirectory(directory: { slug: string; name: string; description: string; moderatorId?: string | null }[]) {
  for (const item of directory) {
    const current = boards.find((board) => board.slug === item.slug);
    if (current) { current.name = item.name; current.desc = item.description; current.moderatorId = item.moderatorId || null; }
    else boards.push({ slug: item.slug, name: item.name, desc: item.description, icon: item.slug === 'news' ? 'book-open' : item.slug === 'forecasts' ? 'compass' : 'messages-square', moderatorId: item.moderatorId || null });
  }
}

export const boardGuides: Record<Board, string[]> = {
  daily: ['分享校园里的见闻、照片或小故事。', '发照片前留意画面里的同学和个人信息。'],
  questions: [
    '标题写清问题，正文补上地点、时间和已试过的方法。',
    '找到答案后，可以采纳回复或追加进展。',
  ],
  market: ['写明物品成色、价格和校内交接地点。', '当面验货再付款，成交后标记已出。'],
  treehole: ['聊聊自己的经历和感受。', '尊重他人，省略可识别他人的细节。'],
  buddies: ['写明活动时间、集合地点和参与条件。', '有变更时可以在原帖追加进展。'],
  resources: ['附上资料来源、适用课程或使用说明。', '原创作品可以选择「校园作品」，补充体验方式。'],
};
export const emptyProfile: Profile = {
  name: '游客',
  avatar: '',
  bio: '',
  school: '',
  campus: '',
  dept: '',
  year: '',
  tags: [],
};
export const defaultNotifications = { reply: true, like: true, follow: true, system: false };
export const defaultPrivacy = { profilePublic: true, marksPublic: false };
export const age = (item: { createdAt: number }) => {
  const hours = (Date.now() - item.createdAt) / 3600000;
  return hours < 1
    ? '刚刚'
    : hours < 24
      ? Math.floor(hours) + ' 小时前'
      : Math.round(hours / 24) + ' 天前';
};
export const wikiDate = (wiki: Wiki) =>
  new Date(wiki.updatedAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
export const postHref = (post: Post) => '#/posts/' + post.id;
export const replyHref = (post: Post, reply: Reply) => postHref(post) + '#cm-' + reply.id;
export const authorHref = (id: string) => '#/users/' + encodeURIComponent(id);
export const inboxHref = (peer = '', post = '') =>
  '#/inbox' + (peer ? '/' + peer : '') + (post ? '?' + new URLSearchParams({ post }) : '');
export const searchHref = (q: string, type = 'all', board = '') =>
  '#/search?' + new URLSearchParams({ q, type, ...(board ? { board } : {}) });
export function parseRoute(hash: string) {
  const [path = '/', anchor = ''] = hash.replace(/^#/, '').split('#');
  const [pathname = '/', query = ''] = path.split('?');
  return {
    parts: pathname
      .split('/')
      .filter(Boolean)
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      }),
    params: new URLSearchParams(query),
    anchor,
  };
}
export function cleanHtml(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const allowed = new Set([
    'P',
    'BR',
    'STRONG',
    'B',
    'EM',
    'I',
    'U',
    'S',
    'DEL',
    'H1',
    'H4',
    'H5',
    'H6',
    'HR',
    'TABLE',
    'THEAD',
    'TBODY',
    'TR',
    'TH',
    'TD',
    'H2',
    'H3',
    'BLOCKQUOTE',
    'PRE',
    'CODE',
    'UL',
    'OL',
    'LI',
    'A',
    'DIV',
  ]);
  template.content
    .querySelectorAll('script,style,iframe,object,embed,link,meta,form,svg,math')
    .forEach((node) => node.remove());
  for (const node of template.content.querySelectorAll('*')) {
    if (!allowed.has(node.tagName)) {
      node.replaceWith(
        document.createTextNode(
          node.tagName === 'IMG' ? node.getAttribute('alt') || '' : node.textContent || '',
        ),
      );
      continue;
    }
    const href = node.tagName === 'A' ? node.getAttribute('href') : null;
    for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
    if (href && /^(https?:|mailto:|#)/i.test(href)) {
      node.setAttribute('href', href);
      node.setAttribute('rel', 'nofollow ugc noopener noreferrer');
    }
  }
  return template.innerHTML;
}
export function plainText(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return (template.content.textContent || '').trim();
}
export async function readImage(file: File) {
  if (
    !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) ||
    file.size > 1000000
  )
    throw new Error('请选择 1MB 内的 JPG、PNG、GIF 或 WebP 图片');
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('图片读取失败'));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}
