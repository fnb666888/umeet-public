import { api, render } from '../../utils/api';
import { applyTheme } from '../../utils/theme';
Page({
  data: {
    id: '',
    history: [] as any[],
    selected: [] as string[],
    diff: null as any,
    blocks: [] as any[],
    error: '',
  },
  onLoad(q) {
    this.setData({ id: q.id || '' });
  },
  onShow() {
    applyTheme(this);
    this.load();
  },
  async load() {
    try {
      this.setData({ history: await api('knowledge/pages/' + this.data.id + '/history') });
    } catch (e: any) {
      this.setData({ error: e.message });
    }
  },
  select(e: WechatMiniprogram.CustomEvent) {
    const id = e.currentTarget.dataset.id,
      old = this.data.selected;
    this.setData({
      selected: old.includes(id) ? old.filter((v) => v !== id) : [...old.slice(-1), id],
    });
  },
  async compare() {
    if (this.data.selected.length !== 2) return;
    try {
      this.setData({
        diff: await api(
          'knowledge/pages/' +
            this.data.id +
            '/diff?fromId=' +
            this.data.selected[0] +
            '&toId=' +
            this.data.selected[1],
        ),
      });
    } catch (e: any) {
      this.setData({ error: e.message });
    }
  },
  async revision(e: WechatMiniprogram.CustomEvent) {
    try {
      const r = await api(
        'knowledge/pages/' + this.data.id + '/revision?revisionId=' + e.currentTarget.dataset.id,
      );
      this.setData({ ...(await render(r.markdown)), diff: null });
    } catch (e: any) {
      this.setData({ error: e.message });
    }
  },
});
