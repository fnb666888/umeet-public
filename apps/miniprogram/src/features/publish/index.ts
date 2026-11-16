import { savePostDraft, readPostDraft, removePostDraft } from '../../utils/post-draft';
import { api, bootstrap, operate, upload, showError, showToast } from '../../utils/api';
import { session, requireLogin, draftKey, uuid } from '../../utils/session';
import { applyTheme } from '../../utils/theme';
Page({
  data: {
    id: '',
    key: '',
    boards: [] as any[],
    boardIndex: 0,
    community: 'daily',
    title: '',
    body: '',
    tags: '',
    price: '',
    meeting: '',
    meetingAt: '',
    images: [] as string[],
    busy: false,
    error: '',
    existingId: '',
    saved: '',
    operationId: uuid(),
    postId: uuid(),
  },
  _owner: '',
  _submitted: false,
  onLoad(q) {
    this._owner = session()?.actor.userId ?? '';
    if (!requireLogin()) return;
    const key =
      q.draft && q.draft.startsWith('umeet:draft:' + this._owner + ':post:')
        ? q.draft
        : draftKey('post', q.id || 'new');
    this.setData({ id: q.id || '', key, community: q.board || 'daily' });
    this.restore();
    this.setup();
  },
  onShow() {
    applyTheme(this);
    if (this._owner !== session()?.actor.userId) {
      wx.redirectTo({ url: '/features/publish/index' });
    }
  },
  async setup() {
    try {
      const b = await bootstrap();
      this.setData({ boards: b.boards });
      if (this.data.id) {
        const r = await api('mobile/posts/' + this.data.id);
        if (!r.post.own) throw new Error('只能编辑自己的帖子');
        if (!wx.getStorageSync(this.data.key))
          this.setData({
            title: r.post.title,
            body: r.post.editMarkdown ?? r.post.body,
            community: r.post.community,
          });
      }
      this.setData({
        boardIndex: Math.max(
          0,
          b.boards.findIndex((board: any) => board.slug === this.data.community),
        ),
      });
    } catch (e: any) {
      this.setData({ error: e.message });
    }
  },
  restore() {
    const value = readPostDraft(this.data.key);
    if (value) {
      this.setData({
        ...value,
        key: this.data.key,
        id: value.id || this.data.id,
        saved: '已恢复本机草稿',
      });
    }
  },
  persist() {
    if (this._submitted || this._owner !== session()?.actor.userId) return;
    try {
      const d = this.data;
      savePostDraft(d.key, {
        id: d.id,
        title: d.title,
        body: d.body,
        tags: d.tags,
        community: d.community,
        price: d.price,
        meeting: d.meeting,
        meetingAt: d.meetingAt,
        images: d.images,
        operationId: d.operationId,
        postId: d.postId,
      });
      this.setData({ saved: '已保存在本机，尚未发布' });
    } catch {
      this.setData({ error: '本机草稿保存失败，请保留当前页面' });
    }
  },
  onHide() {
    this.persist();
  },
  onUnload() {
    if (this.data.title || this.data.body) this.persist();
  },
  input(e: WechatMiniprogram.CustomEvent) {
    if (this.data.busy) return;
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
    this.setData({ operationId: uuid() });
    this.persist();
  },
  board(e: WechatMiniprogram.CustomEvent) {
    if (this.data.busy) return;
    const i = Number(e.detail.value);
    this.setData({ boardIndex: i, community: this.data.boards[i].slug, operationId: uuid() });
    this.persist();
  },
  async images() {
    if (this.data.busy) return;
    try {
      const selected = await wx.chooseMedia({
        count: 4 - this.data.images.length,
        mediaType: ['image'],
        sizeType: ['compressed'],
      });
      const images = [...this.data.images];
      for (const item of selected.tempFiles) {
        if (item.size > 1000000) throw new Error('请压缩至 1MB 以下后添加图片');
        images.push((await upload(item.tempFilePath)).id);
      }
      this.setData({ images, operationId: uuid() });
      this.persist();
    } catch (e: any) {
      if (!String(e.errMsg || '').includes('cancel')) showError(e);
    }
  },
  removeImage(e: WechatMiniprogram.CustomEvent) {
    if (this.data.busy) return;
    this.setData({
      operationId: uuid(),
      images: this.data.images.filter((_, i) => i !== Number(e.currentTarget.dataset.index)),
    });
    this.persist();
  },
  existing() {
    wx.navigateTo({ url: '/features/detail/index?id=' + this.data.existingId });
  },
  newCopy() {
    this.setData({ id: '', postId: uuid(), operationId: uuid(), existingId: '', error: '' });
    this.persist();
  },
  async submit() {
    if (this.data.busy || !requireLogin()) return;
    if (this._owner !== session()?.actor.userId) {
      this.setData({ error: '账号已变化，请重新打开发布页面；原稿保存在原账号下' });
      return;
    }
    if (!this.data.title.trim() || !this.data.body.trim()) {
      this.setData({ error: '请填写标题和正文' });
      return;
    }
    this.setData({ busy: true, error: '' });
    this.persist();
    try {
      const d = this.data,
        id = d.id || d.postId;
      const post = {
        id,
        community: d.community,
        title: d.title.trim(),
        body: d.body,
        images: d.images,
        tags: d.tags
          .split(/[，,]/)
          .map((t) => t.trim())
          .filter(Boolean),
        ...(d.price ? { price: d.price } : {}),
        ...(d.meeting ? { meeting: d.meeting } : {}),
        ...(d.meetingAt ? { meetingAt: new Date(d.meetingAt).getTime() } : {}),
      };
      if (d.id)
        await api('mobile/posts/' + id + '/edit', 'POST', {
          id: d.operationId,
          title: post.title,
          markdown: post.body,
        });
      else await operate([{ type: 'post.create', post }], d.operationId);
      this._submitted = true;
      removePostDraft(d.key);
      this.setData({ title: '', body: '', saved: '已提交' });
      showToast('已提交，是否直接展示取决于板块审核规则');
      const state = await bootstrap().catch(() => ({ postReviews: [] }));
      const pending = state.postReviews?.some(
        (p: any) => p.id === id || p.postId === id || p.post?.id === id,
      );
      wx.redirectTo({
        url: pending ? '/features/records/index?view=posts' : '/features/detail/index?id=' + id,
      });
    } catch (e: any) {
      this.setData({
        error: e.message,
        ...(e.code === 'POST_EXISTS'
          ? {
              existingId: this.data.postId,
              error: '这份帖子已经提交过，当前改动仍保留在草稿。请查看已有帖子，或另存为新帖子。',
            }
          : {}),
      });
    } finally {
      this.setData({ busy: false });
    }
  },
});
