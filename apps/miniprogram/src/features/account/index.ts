import { api, showError } from '../../utils/api';
import { session, saveSession, clearSession } from '../../utils/session';
import { applyTheme } from '../../utils/theme';
Page({
  data: {
    account: null as any,
    username: '',
    password: '',
    email: '',
    code: '',
    challengeId: '',
    inviteCode: '',
    passwordAgain: '',
    mode: 'password',
    busy: false,
    message: '',
    channels: { email: false, wechatMini: false },
    cooldown: 0,
  },
  async onShow() {
    applyTheme(this);
    try {
      const channels = await api('auth/channels');
      this.setData({ channels });
      if (session()) this.setData({ account: await api('account') });
    } catch (e: any) {
      this.setData({ message: e.message });
    }
  },
  input(e: WechatMiniprogram.CustomEvent) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [field]: e.detail.value,
      ...(field === 'email' ? { challengeId: '', code: '' } : {}),
    });
  },
  mode(e: WechatMiniprogram.CustomEvent) {
    this.setData({
      mode: e.currentTarget.dataset.mode,
      message: '',
      password: '',
      passwordAgain: '',
      code: '',
      challengeId: '',
    });
  },
  async login() {
    if (this.data.busy) return;
    this.setData({ busy: true, message: '' });
    try {
      const mode = this.data.mode;
      if (
        (mode === 'register' || mode === 'recovery') &&
        (this.data.password.length < 12 || this.data.password !== this.data.passwordAgain)
      )
        throw new Error('请填写至少12位密码，并确认两次输入一致');
      const verify = { challengeId: this.data.challengeId, code: this.data.code };
      const r =
        mode === 'register'
          ? await api('auth/otp/register', 'POST', {
              ...verify,
              username: this.data.username.trim(),
              password: this.data.password,
              ...(this.data.inviteCode.trim() ? { inviteCode: this.data.inviteCode.trim() } : {}),
            })
          : mode === 'recovery'
            ? await api('auth/otp/recovery', 'POST', { ...verify, password: this.data.password })
            : mode === 'password'
              ? await api('auth/login', 'POST', {
                  username: this.data.username.trim(),
                  password: this.data.password,
                })
              : await api('auth/otp/login', 'POST', {
                  challengeId: this.data.challengeId,
                  code: this.data.code,
                });
      saveSession(r);
      this.setData({
        password: '',
        code: '',
        account: await api('account'),
        message: '已登录，社区与网站共享同一账号。',
      });
      wx.reLaunch({ url: '/pages/me/index' });
    } catch (e: any) {
      this.setData({ message: e.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async send() {
    if (this.data.busy || Date.now() < this.data.cooldown) return;
    this.setData({ busy: true, message: '' });
    try {
      const r = await api('auth/otp/request', 'POST', {
        channel: 'email',
        recipient: this.data.email.trim(),
        purpose:
          this.data.mode === 'register'
            ? 'register'
            : this.data.mode === 'recovery'
              ? 'recovery'
              : 'login',
      });
      this.setData({
        challengeId: r.challengeId,
        cooldown: Date.now() + r.resendAfterSeconds * 1000,
        message: '验证码已发送，请查收邮箱',
      });
    } catch (e: any) {
      this.setData({ message: e.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async wechat() {
    if (this.data.busy) return;
    this.setData({ busy: true, message: '' });
    try {
      const code = await new Promise<string>((resolve, reject) =>
        wx.login({ success: (r) => resolve(r.code), fail: reject }),
      );
      if (session()) await api('auth/wechat/link', 'POST', { code });
      else saveSession(await api('auth/wechat/mini', 'POST', { code }));
      this.setData({ account: await api('account'), message: '微信已连接当前账号。' });
    } catch (e: any) {
      this.setData({ message: e.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async logout() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await api('auth/logout', 'POST', {});
      clearSession();
      this.setData({
        account: null,
        password: '',
        code: '',
        challengeId: '',
        message: '已退出当前账号',
      });
      wx.reLaunch({ url: '/features/account/index' });
    } catch (e) {
      showError(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  back() {
    wx.switchTab({ url: '/pages/me/index' });
  },
});
