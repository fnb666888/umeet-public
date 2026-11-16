import {
  api,
  upload,
  isLogged,
  schoolId,
  showError,
  showToast,
  formatDate,
  labels,
} from '../../utils/api';
Page({
  data: {
    schoolName: '',
    verified: false,
    expires: '',
    email: '',
    code: '',
    requestId: '',
    image: '',
    materialId: '',
    requests: [] as any[],
    busy: false,
  },
  async onShow() {
    if (!isLogged()) {
      wx.switchTab({ url: '/pages/me/index' });
      return;
    }
    try {
      const [schools, me, requests] = await Promise.all([
        api<any[]>('/schools'),
        api('/me'),
        api<any[]>('/me/verifications'),
      ]);
      const s = schools.find((s) => s.id === schoolId()),
        m = me.memberships.find((m: any) => m.schoolId === schoolId());
      this.setData({
        schoolName: s?.name || '',
        verified: m?.status === 'VERIFIED',
        expires: m?.expiresAt ? formatDate(m.expiresAt) : '',
        requests: requests.map((r) => ({
          ...r,
          time: formatDate(r.createdAt),
          statusName: labels[r.status] || r.status,
        })),
      });
    } catch (e) {
      showError(e);
    }
  },
  input(e: WechatMiniprogram.CustomEvent) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  async choose() {
    try {
      const r = await new Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult>(
        (resolve, reject) =>
          wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sizeType: ['compressed'],
            success: resolve,
            fail: reject,
          }),
      );
      this.setData({ image: r.tempFiles[0].tempFilePath });
    } catch (e: any) {
      if (!e.errMsg?.includes('cancel')) showError(e);
    }
  },
  async manual() {
    if (!this.data.image || this.data.busy) {
      showToast('请选择认证材料');
      return;
    }
    this.setData({ busy: true });
    try {
      const media = await upload(this.data.image, 'VERIFICATION');
      await api('/verifications/manual', 'POST', { schoolId: schoolId(), materialId: media.id });
      this.setData({ image: '', materialId: '' });
      showToast('认证申请已提交');
      await this.onShow();
    } catch (e) {
      showError(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async sendCode() {
    this.setData({ busy: true });
    try {
      const result = await api('/verifications/email', 'POST', {
        schoolId: schoolId(),
        email: this.data.email,
      });
      this.setData({ requestId: result.id });
      showToast('验证码已发送');
    } catch (e) {
      showError(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async confirm() {
    try {
      const r = await api('/verifications/email/confirm', 'POST', {
        id: this.data.requestId,
        code: this.data.code,
      });
      if (!r.ok) throw new Error(r.message);
      showToast('认证已通过');
      await this.onShow();
    } catch (e) {
      showError(e);
    }
  },
});
