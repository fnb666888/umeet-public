import { api, formatDate, showError } from '../../utils/api';
import { session, requireLogin, uuid } from '../../utils/session';
import { applyTheme } from '../../utils/theme';
Page({
  data: {
    peer: '',
    conversation: null as any,
    messages: [] as any[],
    hasMore: false,
    text: '',
    busy: false,
    error: '',
    sendId: uuid(),
  },
  _owner: '',
  _poll: 0 as any,
  onLoad(q) {
    this.setData({ peer: q.peer || '' });
  },
  onShow() {
    applyTheme(this);
    const owner = session()?.actor.userId ?? '';
    if (owner !== this._owner) {
      this._owner = owner;
      this.setData({ conversation: null, messages: [], text: '', error: '', sendId: uuid() });
    }
    if (requireLogin()) {
      this.load();
      clearInterval(this._poll);
      this._poll = setInterval(() => {
        if (!this.data.busy) this.load();
      }, 10000);
    }
  },
  onHide() {
    clearInterval(this._poll);
  },
  onUnload() {
    clearInterval(this._poll);
  },
  async load(older = false) {
    try {
      const first = this.data.messages[0];
      const r = await api(
        'messages/' + this.data.peer + (older && first ? '?before=' + first.id : ''),
      );
      const rows = r.messages.map((m: any) => ({ ...m, time: formatDate(m.createdAt) }));
      this.setData({
        conversation: r.conversation,
        messages: older ? [...rows, ...this.data.messages] : rows,
        hasMore: r.hasMore,
        error: '',
      });
      const last = r.messages[r.messages.length - 1];
      if (last && r.conversation.unread)
        await api('messages/' + this.data.peer + '/action', 'POST', {
          action: 'read',
          messageId: last.id,
        });
    } catch (e: any) {
      this.setData({ error: e.message });
    }
  },
  older() {
    this.load(true);
  },
  input(e: WechatMiniprogram.CustomEvent) {
    this.setData({ text: e.detail.value });
  },
  async send() {
    if (
      this.data.busy ||
      !this.data.text.trim() ||
      !requireLogin() ||
      this._owner !== session()?.actor.userId
    )
      return;
    this.setData({ busy: true, error: '' });
    try {
      await api('messages/' + this.data.peer + '/send', 'POST', {
        id: this.data.sendId,
        text: this.data.text,
      });
      this.setData({ text: '', sendId: uuid() });
      await this.load();
    } catch (e: any) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async action(e: WechatMiniprogram.CustomEvent) {
    if (this.data.busy) return;
    const action = e.currentTarget.dataset.action;
    this.setData({ busy: true });
    try {
      let body: any = { action };
      if (action === 'block' || action === 'mute')
        body.value = !this.data.conversation[action === 'block' ? 'blocked' : 'muted'];
      if (action === 'report') {
        const result = await wx.showModal({
          title: '举报消息',
          editable: true,
          placeholderText: '说明举报原因',
        });
        if (!result.confirm) return;
        const last = this.data.messages.filter((m) => m.incoming).slice(-1)[0];
        if (!last) throw new Error('没有可举报的收到消息');
        body = { action, id: uuid(), messageId: last.id, reason: result.content || '请核查此消息' };
      }
      await api('messages/' + this.data.peer + '/action', 'POST', body);
      await this.load();
    } catch (e) {
      showError(e);
    } finally {
      this.setData({ busy: false });
    }
  },
});
