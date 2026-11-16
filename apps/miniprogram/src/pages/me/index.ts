import { api, bootstrap, showError } from '../../utils/api';
import { session, requireLogin } from '../../utils/session';
import { applyTheme } from '../../utils/theme';
Page({
  data: { actor: null as any, profile: null as any, restricted: false, error: '' },
  async onShow() {
    applyTheme(this);
    try {
      const b = await bootstrap();
      this.setData({
        actor: b.actor,
        profile: b.userState.profile ?? null,
        restricted: b.restricted,
        error: '',
      });
    } catch (e: any) {
      this.setData({ error: e.message, actor: session()?.actor ?? null });
    }
  },
  account() {
    wx.navigateTo({ url: '/features/account/index' });
  },
  records(e: WechatMiniprogram.CustomEvent) {
    if (requireLogin())
      wx.navigateTo({ url: '/features/records/index?view=' + e.currentTarget.dataset.view });
  },
  settings() {
    wx.navigateTo({ url: '/features/settings/index' });
  },
  governance() {
    if (requireLogin()) wx.navigateTo({ url: '/features/governance/index' });
  },
  knowledge() {
    if (requireLogin()) wx.navigateTo({ url: '/features/knowledge-manage/index' });
  },
  policy() {
    wx.navigateTo({ url: '/features/policy/index' });
  },
});
