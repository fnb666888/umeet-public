import { api, render, openContent, formatDate, showError } from '../../utils/api';
import { requireLogin } from '../../utils/session';
import { relationLabel } from '../../utils/knowledge';
import { applyTheme } from '../../utils/theme';
Page({
  data: {
    id: '',
    page: null as any,
    blocks: [] as any[],
    links: [] as any[],
    relations: [] as any[],
    incoming: [] as any[],
    discussions: [] as any[],
    discussion: '',
    busy: false,
    error: '',
  },
  onLoad(q) {
    this.setData({ id: q.id || '' });
  },
  onShow() {
    applyTheme(this);
    this.load();
  },
  onShareAppMessage() {
    return {
      title: this.data.page?.title || 'Wiki',
      path: '/features/knowledge-detail/index?id=' + this.data.id,
    };
  },
  async load() {
    this.setData({ error: '' });
    try {
      const page = await api('knowledge/pages/' + this.data.id);
      this.setData({ page: { ...page, time: formatDate(page.createdAt) } });
      this.setData(await render(page.markdown));
      const [relations, discussions] = await Promise.all([
        api('knowledge/pages/' + page.id + '/relations'),
        api('knowledge/pages/' + page.id + '/discussions'),
      ]);
      const rows = await Promise.all(
        relations.outgoing.map(async (r: any) => {
          let title = '词条不可用';
          if (r.available) title = (await api('knowledge/pages/' + r.targetPageId)).title;
          return { ...r, title, label: relationLabel(r.type) };
        }),
      );
      const incoming = await Promise.all(
        relations.incoming.map(async (r: any) => ({
          ...r.relation,
          targetPageId: r.sourcePageId,
          available: true,
          title: (await api('knowledge/pages/' + r.sourcePageId)).title,
          label: relationLabel(r.relation.type),
        })),
      );
      this.setData({ relations: rows, incoming, discussions });
    } catch (e: any) {
      this.setData({
        error: e.message,
        ...(e.status === 404
          ? { page: null, blocks: [], relations: [], incoming: [], discussions: [] }
          : {}),
      });
    }
  },
  edit() {
    if (requireLogin())
      wx.navigateTo({ url: '/features/knowledge-editor/index?id=' + this.data.id });
  },
  history() {
    wx.navigateTo({ url: '/features/knowledge-history/index?id=' + this.data.id });
  },
  relation(e: WechatMiniprogram.CustomEvent) {
    if (e.currentTarget.dataset.available)
      wx.navigateTo({ url: '/features/knowledge-detail/index?id=' + e.currentTarget.dataset.id });
  },
  link(e: WechatMiniprogram.CustomEvent) {
    openContent(e.currentTarget.dataset.url);
  },
  input(e: WechatMiniprogram.CustomEvent) {
    this.setData({ discussion: e.detail.value });
  },
  async discuss() {
    if (!requireLogin() || this.data.busy || !this.data.discussion.trim()) return;
    this.setData({ busy: true });
    try {
      await api('knowledge/pages/' + this.data.id + '/discussions', 'POST', {
        body: this.data.discussion,
      });
      this.setData({ discussion: '' });
      await this.load();
    } catch (e) {
      showError(e);
    } finally {
      this.setData({ busy: false });
    }
  },
});
