import { api, displayPost } from '../../utils/api';
import { applyTheme } from '../../utils/theme';
import { requireLogin } from '../../utils/session';
Page({
  data: {
    id: '',
    profile: null as any,
    posts: [] as any[],
    error: '',
    next: null as string | null,
  },
  onLoad(q) {
    this.setData({ id: q.id || '' });
  },
  onShow() {
    applyTheme(this);
    this.load();
  },
  async load(append = false) {
    try {
      if (!append) this.setData({ profile: await api('mobile/profiles/' + this.data.id) });
      const r = await api(
        'mobile/feed?author=' +
          this.data.id +
          (append && this.data.next ? '&cursor=' + this.data.next : ''),
      );
      this.setData({
        posts: [...(append ? this.data.posts : []), ...r.items.map(displayPost)],
        next: r.next,
        error: '',
      });
    } catch (e: any) {
      this.setData({ error: e.message });
    }
  },
  onReachBottom() {
    if (this.data.next) this.load(true);
  },
  open(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: '/features/detail/index?id=' + e.detail.id });
  },
  message() {
    if (requireLogin()) wx.navigateTo({ url: '/features/conversation/index?peer=' + this.data.id });
  },
});
