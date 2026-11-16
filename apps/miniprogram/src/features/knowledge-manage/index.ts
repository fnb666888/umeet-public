import { api } from '../../utils/api';
import { requireLogin, currentUser } from '../../utils/session';
import { applyTheme } from '../../utils/theme';
Page({
  data: {
    drafts: [] as any[],
    local: [] as any[],
    proposals: [] as any[],
    next: '',
    loading: false,
    error: '',
  },
  onShow() {
    applyTheme(this);
    if (requireLogin()) this.load();
  },
  async load(append = false) {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const proposals = await api(
        'knowledge/proposals?limit=20' +
          (append && this.data.next ? '&cursor=' + this.data.next : ''),
      );
      const drafts = await api('knowledge/drafts');
      const prefix = 'umeet:draft:' + currentUser() + ':wiki:';
      const local = wx
        .getStorageInfoSync()
        .keys.filter((k) => k.startsWith(prefix))
        .map((k) => wx.getStorageSync(k))
        .filter((v) => v.unsynced);
      this.setData({
        drafts,
        local,
        proposals: [
          ...(append ? this.data.proposals : []),
          ...proposals.filter((p: any) => p.authorId === currentUser()),
        ],
        next: proposals.length === 20 ? proposals[proposals.length - 1].id : '',
      });
    } catch (e: any) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  onReachBottom() {
    if (this.data.next) this.load(true);
  },
  draft(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({
      url:
        '/features/knowledge-editor/index?task=' +
        e.currentTarget.dataset.task +
        (e.currentTarget.dataset.page ? '&id=' + e.currentTarget.dataset.page : ''),
    });
  },
  proposal(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({
      url: '/features/knowledge-editor/index?proposal=' + e.currentTarget.dataset.id,
    });
  },
  create() {
    wx.navigateTo({ url: '/features/knowledge-editor/index' });
  },
});
