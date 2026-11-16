import { api, bootstrap, displayPost } from '../../utils/api';
import { requireLogin, currentUser } from '../../utils/session';
import { applyTheme } from '../../utils/theme';
Page({
  data: {
    view: 'posts',
    title: '我的发布',
    items: [] as any[],
    reviews: [] as any[],
    next: null as string | null,
    loading: false,
    error: '',
  },
  onLoad(q) {
    const view = q.view || 'posts';
    this.setData({
      view,
      title:
        (
          {
            posts: '我的发布',
            replies: '我的回复',
            bookmarks: '我的收藏',
            drafts: '发帖草稿',
          } as any
        )[view] || '我的记录',
    });
  },
  onShow() {
    applyTheme(this);
    if (requireLogin()) this.load();
  },
  onReachBottom() {
    if (this.data.next) this.load(true);
  },
  async load(append = false) {
    if (this.data.loading) return;
    if (this.data.view === 'drafts') {
      const prefix = 'umeet:draft:' + currentUser() + ':post:';
      const items = wx
        .getStorageInfoSync()
        .keys.filter((k) => k.startsWith(prefix))
        .map((key) => ({ ...wx.getStorageSync(key), key }));
      this.setData({ items });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      if (this.data.view === 'posts') this.setData({ reviews: (await bootstrap()).postReviews });
      const r = await api(
        'mobile/feed?view=' +
          this.data.view +
          (append && this.data.next ? '&cursor=' + this.data.next : ''),
      );
      this.setData({
        items: [...(append ? this.data.items : []), ...r.items.map(displayPost)],
        next: r.next,
      });
    } catch (e: any) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  open(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: '/features/detail/index?id=' + e.detail.id });
  },
  draft(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({
      url: '/features/publish/index?draft=' + encodeURIComponent(e.currentTarget.dataset.key),
    });
  },
});
