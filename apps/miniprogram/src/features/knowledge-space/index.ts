import { api } from '../../utils/api';
import { applyTheme } from '../../utils/theme';
Page({
  data: { slug: '', space: null as any, nodes: [] as any[], routes: [] as any[], error: '' },
  onLoad(q) {
    this.setData({ slug: q.slug || '' });
  },
  onShow() {
    applyTheme(this);
    this.load();
  },
  async load() {
    try {
      const space = await api('knowledge/communities/' + this.data.slug);
      const order: any[] = [];
      const visit = (parent: string | null, depth = 0) => {
        for (const node of space.nodes.filter((n: any) => n.parentId === parent)) {
          order.push({
            ...node,
            depth: depth * 24,
            entries: space.entries.filter((e: any) => e.nodeId === node.id),
          });
          visit(node.id, depth + 1);
        }
      };
      visit(null);
      const routes = await api('knowledge/routes?communityId=' + space.id);
      this.setData({ space, nodes: order, routes, error: '' });
    } catch (e: any) {
      this.setData({ error: e.message });
    }
  },
  open(e: WechatMiniprogram.CustomEvent) {
    if (e.currentTarget.dataset.available)
      wx.navigateTo({ url: '/features/knowledge-detail/index?id=' + e.currentTarget.dataset.id });
  },
  route(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: '/features/knowledge-route/index?id=' + e.currentTarget.dataset.id });
  },
});
