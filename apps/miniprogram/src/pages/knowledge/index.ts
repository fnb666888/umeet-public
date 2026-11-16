import { api } from '../../utils/api';
import { requireLogin } from '../../utils/session';
import { applyTheme } from '../../utils/theme';
Page({
  data: {
    q: '',
    items: [] as any[],
    communities: [] as any[],
    routes: [] as any[],
    next: null as string | null,
    loading: false,
    error: '',
  },
  _reload: false,
  onShow() {
    applyTheme(this);
    this.load();
  },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },
  onReachBottom() {
    if (this.data.next) this.load(true);
  },
  input(e: WechatMiniprogram.CustomEvent) {
    this.setData({ q: e.detail.value });
  },
  search() {
    this.load();
  },
  async load(append = false) {
    if (this.data.loading) {
      if (!append) this._reload = true;
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const result = await api(
        'mobile/knowledge-feed?limit=20&q=' +
          encodeURIComponent(this.data.q) +
          (append && this.data.next ? '&cursor=' + this.data.next : ''),
      );
      this.setData({
        items: [...(append ? this.data.items : []), ...result.items],
        next: result.nextCursor,
      });
      if (!append) {
        const [communities, routes] = await Promise.all([
          api('knowledge/communities'),
          api('knowledge/routes'),
        ]);
        this.setData({ communities, routes });
      }
    } catch (e: any) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
      if (this._reload) {
        this._reload = false;
        void this.load();
      }
    }
  },
  open(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: '/features/knowledge-detail/index?id=' + e.currentTarget.dataset.id });
  },
  space(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: '/features/knowledge-space/index?slug=' + e.currentTarget.dataset.slug });
  },
  route(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: '/features/knowledge-route/index?id=' + e.currentTarget.dataset.id });
  },
  create() {
    if (requireLogin()) wx.navigateTo({ url: '/features/knowledge-editor/index' });
  },
  manage() {
    if (requireLogin()) wx.navigateTo({ url: '/features/knowledge-manage/index' });
  },
});
