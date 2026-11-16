import { api, bootstrap, displayPost, showError } from '../../utils/api';
import { applyTheme } from '../../utils/theme';
import { requireLogin } from '../../utils/session';
Page({
  data: {
    boards: [] as any[],
    posts: [] as any[],
    q: '',
    board: '',
    sort: 'latest',
    next: null as string | null,
    loading: false,
    error: '',
    restricted: false,
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
    if (this.data.next && !this.data.loading) this.load(true);
  },
  async load(append = false) {
    if (this.data.loading) {
      if (!append) this._reload = true;
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      if (!append) {
        const b = await bootstrap();
        this.setData({ boards: b.boards, restricted: b.restricted });
        if (b.restricted) {
          this.setData({ posts: [], error: '账号使用受限，请到“我的”查看管理记录并申诉' });
          return;
        }
      }
      const q = { ...this.data };
      const result = await api(
        'mobile/feed?limit=20&q=' +
          encodeURIComponent(q.q) +
          '&sort=' +
          q.sort +
          (q.board ? '&board=' + q.board : '') +
          (append && q.next ? '&cursor=' + encodeURIComponent(q.next) : ''),
      );
      this.setData({
        posts: [...(append ? q.posts : []), ...result.items.map(displayPost)],
        next: result.next,
      });
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
  searchInput(e: WechatMiniprogram.CustomEvent) {
    this.setData({ q: e.detail.value });
  },
  search() {
    this.load();
  },
  pickBoard(e: WechatMiniprogram.CustomEvent) {
    this.setData({ board: e.currentTarget.dataset.id });
    this.load();
  },
  pickSort(e: WechatMiniprogram.CustomEvent) {
    this.setData({ sort: e.currentTarget.dataset.id });
    this.load();
  },
  open(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: '/features/detail/index?id=' + e.detail.id });
  },
  publish() {
    if (requireLogin())
      wx.navigateTo({
        url: '/features/publish/index' + (this.data.board ? '?board=' + this.data.board : ''),
      });
  },
  apply() {
    if (requireLogin()) wx.navigateTo({ url: '/features/governance/index' });
  },
});
