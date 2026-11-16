import {
  api,
  operate,
  displayPost,
  formatDate,
  render,
  openContent,
  assetURL,
  showError,
  showToast,
} from '../../utils/api';
import { requireLogin, uuid } from '../../utils/session';
import { applyTheme } from '../../utils/theme';
Page({
  data: {
    id: '',
    post: null as any,
    replies: [] as any[],
    next: null as string | null,
    reply: '',
    replyTo: null as any,
    busy: false,
    loading: false,
    error: '',
    blocks: [] as any[],
    links: [] as any[],
    replyId: uuid(),
  },
  onLoad(q) {
    this.setData({ id: q.id || '' });
  },
  onShow() {
    applyTheme(this);
    this.load();
  },
  onShareAppMessage() {
    return {
      title: this.data.post?.title ?? 'Umeet 社区',
      path: '/features/detail/index?id=' + this.data.id,
    };
  },
  onReachBottom() {
    if (this.data.next && !this.data.loading) this.load(true);
  },
  async load(append = false) {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const r = await api(
        'mobile/posts/' +
          this.data.id +
          (append && this.data.next ? '?cursor=' + this.data.next : ''),
      );
      const post = { ...displayPost(r.post), images: (r.post.images ?? []).map(assetURL) };
      this.setData({
        post,
        replies: [
          ...(append ? this.data.replies : []),
          ...r.replies.items.map((reply: any) => ({ ...reply, time: formatDate(reply.createdAt) })),
        ],
        next: r.replies.next,
      });
      if (!append) {
        const body = await render(post.body, post.html);
        this.setData(body);
      }
    } catch (e: any) {
      this.setData({
        error: e.message,
        ...(e.status === 404 ? { post: null, replies: [], blocks: [] } : {}),
      });
    } finally {
      this.setData({ loading: false });
    }
  },
  input(e: WechatMiniprogram.CustomEvent) {
    this.setData({ reply: e.detail.value });
  },
  replyTo(e: WechatMiniprogram.CustomEvent) {
    this.setData({ replyTo: this.data.replies[e.currentTarget.dataset.index] });
  },
  cancelReply() {
    this.setData({ replyTo: null });
  },
  async send() {
    if (!requireLogin() || this.data.busy || !this.data.reply.trim()) return;
    this.setData({ busy: true });
    try {
      const target = this.data.replyTo;
      await operate([
        {
          type: 'reply.create',
          postId: this.data.id,
          reply: {
            id: this.data.replyId,
            body: this.data.reply.trim(),
            ...(target ? { parentId: target.parentId || target.id, replyTo: target.id } : {}),
          },
        },
      ]);
      this.setData({ reply: '', replyId: uuid(), replyTo: null });
      await this.load();
    } catch (e) {
      showError(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async like() {
    if (!requireLogin() || this.data.busy) return;
    this.setData({ busy: true });
    try {
      await operate([{ type: 'post.vote', postId: this.data.id, value: !this.data.post.liked }]);
      await this.load();
    } catch (e) {
      showError(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async bookmark() {
    if (!requireLogin() || this.data.busy) return;
    this.setData({ busy: true });
    try {
      const b = await api('mobile/bootstrap'),
        old = b.userState.bookmarks ?? [];
      await operate([
        {
          type: 'state.save',
          state: {
            bookmarks: this.data.post.bookmarked
              ? old.filter((id: string) => id !== this.data.id)
              : [...old, this.data.id],
          },
        },
      ]);
      await this.load();
    } catch (e) {
      showError(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async voteReply(e: WechatMiniprogram.CustomEvent) {
    if (!requireLogin()) return;
    const reply = this.data.replies[e.currentTarget.dataset.index];
    try {
      await operate([
        { type: 'reply.vote', postId: this.data.id, replyId: reply.id, value: !reply.liked },
      ]);
      await this.load();
    } catch (f) {
      showError(f);
    }
  },
  async accept(e: WechatMiniprogram.CustomEvent) {
    const reply = this.data.replies[e.currentTarget.dataset.index];
    try {
      await operate([
        {
          type: 'post.accept',
          postId: this.data.id,
          replyId: this.data.post.best === reply.id ? null : reply.id,
        },
      ]);
      await this.load();
    } catch (f) {
      showError(f);
    }
  },
  async sold() {
    try {
      await operate([{ type: 'post.sold', postId: this.data.id, value: !this.data.post.sold }]);
      await this.load();
    } catch (e) {
      showError(e);
    }
  },
  edit() {
    wx.navigateTo({ url: '/features/publish/index?id=' + this.data.id });
  },
  profile(e: WechatMiniprogram.CustomEvent) {
    wx.navigateTo({ url: '/features/profile/index?id=' + e.currentTarget.dataset.id });
  },
  message() {
    if (requireLogin())
      wx.navigateTo({ url: '/features/conversation/index?peer=' + this.data.post.authorId });
  },
  async report() {
    if (!requireLogin()) return;
    const dialog = await wx.showModal({
      title: '举报内容',
      editable: true,
      placeholderText: '请说明问题',
      confirmText: '提交举报',
    });
    if (!dialog.confirm) return;
    try {
      await api('governance/reports', 'POST', {
        target: 'post:' + this.data.id,
        category: 'other',
        detail: dialog.content || '请核查此内容',
      });
      showToast('举报已提交');
    } catch (e) {
      showError(e);
    }
  },
  link(e: WechatMiniprogram.CustomEvent) {
    openContent(e.currentTarget.dataset.url);
  },
  image(e: WechatMiniprogram.CustomEvent) {
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.post.images });
  },
});
