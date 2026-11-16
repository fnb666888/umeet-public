import { api, bootstrap, operate, upload, assetURL, showError, showToast } from '../../utils/api';
import { session, requireLogin } from '../../utils/session';
import { applyTheme } from '../../utils/theme';
const empty = () => ({
  name: '',
  bio: '',
  avatar: '',
  school: '',
  campus: '',
  dept: '',
  year: '',
  tags: [] as string[],
});
Page({
  data: {
    profile: empty(),
    tagText: '',
    avatarURL: '',
    privacyPrefs: { profilePublic: true, marksPublic: true },
    notifPrefs: { reply: true, like: true, follow: true, system: true },
    allowRequests: true,
    themeChoice: 'system',
    busy: false,
    logged: false,
    loaded: false,
  },
  _owner: '',
  onShow() {
    applyTheme(this);
    const owner = session()?.actor.userId ?? '';
    if (owner !== this._owner) {
      this._owner = owner;
      this.setData({ profile: empty(), avatarURL: '', tagText: '', loaded: false });
    }
    this.setData({
      logged: !!session(),
      themeChoice: wx.getStorageSync('umeet:theme') || 'system',
    });
    if (session()) this.load();
  },
  async load() {
    try {
      const b = await bootstrap(),
        profile = b.userState.profile || { ...empty(), name: b.actor?.nickname || '' };
      this.setData({
        profile,
        avatarURL: assetURL(profile.avatar),
        tagText: profile.tags.join('，'),
        privacyPrefs: b.userState.privacyPrefs ?? { profilePublic: true, marksPublic: true },
        notifPrefs: b.userState.notifPrefs ?? {
          reply: true,
          like: true,
          follow: true,
          system: true,
        },
        allowRequests: b.allowRequests,
        loaded: true,
      });
    } catch (e) {
      showError(e);
    }
  },
  input(e: WechatMiniprogram.CustomEvent) {
    if (this.data.busy) return;
    const field = e.currentTarget.dataset.field;
    this.setData(
      field === 'tags' ? { tagText: e.detail.value } : { ['profile.' + field]: e.detail.value },
    );
  },
  toggle(e: WechatMiniprogram.CustomEvent) {
    if (this.data.busy) return;
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  theme(e: WechatMiniprogram.CustomEvent) {
    const theme = e.currentTarget.dataset.id;
    wx.setStorageSync('umeet:theme', theme);
    this.setData({ themeChoice: theme });
    applyTheme(this);
  },
  async avatar() {
    if (this.data.busy) return;
    try {
      const r = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] });
      if (r.tempFiles[0].size > 1000000) throw new Error('请使用 1MB 以下的头像');
      const image = await upload(r.tempFiles[0].tempFilePath);
      this.setData({ 'profile.avatar': image.id, avatarURL: image.id });
    } catch (e: any) {
      if (!e.errMsg?.includes('cancel')) showError(e);
    }
  },
  async save() {
    if (!requireLogin() || this.data.busy || !this.data.loaded) return;
    if (this._owner !== session()?.actor.userId) {
      showToast('账号已变化，请重新打开设置');
      return;
    }
    this.setData({ busy: true });
    try {
      const d = this.data;
      await operate([
        {
          type: 'profile.save',
          profile: {
            ...d.profile,
            tags: d.tagText
              .split(/[，,]/)
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 6),
          },
        },
        { type: 'state.save', state: { privacyPrefs: d.privacyPrefs, notifPrefs: d.notifPrefs } },
      ]);
      await api('messages/preferences', 'POST', { allowRequests: d.allowRequests });
      showToast('已保存资料与偏好');
    } catch (e) {
      showError(e);
    } finally {
      this.setData({ busy: false });
    }
  },
});
