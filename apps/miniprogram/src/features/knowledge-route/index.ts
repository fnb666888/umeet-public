import { api, render, openContent } from '../../utils/api';
import { applyTheme } from '../../utils/theme';
Page({
  data: {
    id: '',
    route: null as any,
    step: 0,
    page: null as any,
    blocks: [] as any[],
    links: [] as any[],
    introBlocks: [] as any[],
    error: '',
  },
  _readVersion: 0,
  onLoad(q) {
    this.setData({ id: q.id || '' });
  },
  onShow() {
    applyTheme(this);
    this.load();
  },
  async load() {
    try {
      const route = await api('knowledge/routes/' + this.data.id);
      this.setData({ route, error: '' });
      await this.read();
    } catch (e: any) {
      this.setData({ error: e.message });
    }
  },
  async read() {
    const version = ++this._readVersion;
    const step = this.data.route.steps[this.data.step];
    this.setData({ page: null, blocks: [], links: [] });
    try {
      const intro = await render(step.intro || step.goal);
      if (version !== this._readVersion) return;
      this.setData({ introBlocks: intro.blocks, error: '' });
      if (step.available) {
        const page = await api('knowledge/pages/' + step.pageId);
        const content = await render(page.markdown);
        if (version !== this._readVersion) return;
        this.setData({ page, ...content });
      }
    } catch (e: any) {
      this.setData({ error: e.message });
    }
  },
  next() {
    if (this.data.step < this.data.route.steps.length - 1) {
      this.setData({ step: this.data.step + 1 });
      this.read();
      wx.pageScrollTo({ scrollTop: 0 });
    }
  },
  previous() {
    if (this.data.step > 0) {
      this.setData({ step: this.data.step - 1 });
      this.read();
      wx.pageScrollTo({ scrollTop: 0 });
    }
  },
  open() {
    wx.navigateTo({
      url: '/features/knowledge-detail/index?id=' + this.data.route.steps[this.data.step].pageId,
    });
  },
  link(e: WechatMiniprogram.CustomEvent) {
    openContent(e.currentTarget.dataset.url);
  },
});
