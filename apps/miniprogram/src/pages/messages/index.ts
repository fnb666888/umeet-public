import { api, bootstrap, operate, formatDate, showError } from '../../utils/api';
import { session, requireLogin } from '../../utils/session';
import { applyTheme } from '../../utils/theme';
Page({
  data: {
    view: 'messages',
    items: [] as any[],
    next: null as string | null,
    unread: 0,
    requests: 0,
    loading: false,
    error: '',
    logged: false,
  },
  _owner: '',
  _reload: false,
  onShow() {
    applyTheme(this);
    const owner = session()?.actor.userId ?? '';
    if (owner !== this._owner) {
      this._owner = owner;
      this.setData({ items: [], next: null, unread: 0, requests: 0, loading: false, error: '' });
      wx.removeTabBarBadge({ index: 2 });
    }
    this.setData({ logged: !!session() });
    if (session()) this.load();
  },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },
  onReachBottom() {
    if (this.data.next) this.load(true);
  },
  tab(e: WechatMiniprogram.CustomEvent) {
    this.setData({ view: e.currentTarget.dataset.id, next: null });
    this.load();
  },
  async load(append = false) {
    if (!session()) return;
    if (this.data.loading) {
      if (!append) this._reload = true;
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const d = { ...this.data };
      const r =
        d.view === 'notifications'
          ? await api('mobile/notifications' + (append && d.next ? '?cursor=' + d.next : ''))
          : await api('messages?view=' + d.view + (append && d.next ? '&cursor=' + d.next : ''));
      const rows = d.view === 'notifications' ? r.items : r.conversations;
      this.setData({
        items: [
          ...(append ? d.items : []),
          ...rows.map((item: any) => ({
            ...item,
            time: formatDate(item.createdAt || item.updatedAt || Date.now()),
          })),
        ],
        next: r.next,
        unread: r.unread ?? 0,
        requests: r.requests ?? 0,
      });
      if (r.unread) wx.setTabBarBadge({ index: 2, text: String(Math.min(r.unread, 99)) });
      else wx.removeTabBarBadge({ index: 2 });
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
  login() {
    requireLogin();
  },
  async open(e: WechatMiniprogram.CustomEvent) {
    const item = this.data.items[e.currentTarget.dataset.index];
    if (this.data.view === 'notifications') {
      try {
        const b = await bootstrap();
        await operate([
          {
            type: 'state.save',
            state: {
              readNotifications: [
                ...new Set([...(b.userState.readNotifications ?? []), item.id]),
              ].slice(-1000),
            },
          },
        ]);
        item.read = true;
      } catch (e) {
        showError(e);
        return;
      }
      const post = item.href?.match(/#\/posts\/([^#?]+)/);
      const wiki = item.href?.match(/\/knowledge\/([^/?#]+)/);
      if (post) wx.navigateTo({ url: '/features/detail/index?id=' + post[1] });
      else if (wiki) wx.navigateTo({ url: '/features/knowledge-detail/index?id=' + wiki[1] });
      else wx.navigateTo({ url: '/features/governance/index' });
    } else wx.navigateTo({ url: '/features/conversation/index?peer=' + item.peer });
  },
  async search() {
    if (!requireLogin()) return;
    const d = await wx.showModal({
      title: '发起私信',
      editable: true,
      placeholderText: '搜索昵称或用户名',
    });
    if (!d.confirm || !d.content) return;
    try {
      const r = await api('messages/users?q=' + encodeURIComponent(d.content));
      const rows = Array.isArray(r) ? r : (r.items ?? []);
      if (!rows.length) throw new Error('未找到用户');
      const selected = await wx.showActionSheet({
        itemList: rows.slice(0, 6).map((p: any) => p.name || p.nickname || p.handle),
      });
      wx.navigateTo({ url: '/features/conversation/index?peer=' + rows[selected.tapIndex].id });
    } catch (e) {
      showError(e);
    }
  },
});
