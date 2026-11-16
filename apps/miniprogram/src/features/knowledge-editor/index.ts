import { api, ApiError, render, openContent, showError, showToast } from '../../utils/api';
import { session, requireLogin, draftKey, uuid } from '../../utils/session';
import { blank, templates, contentOf, relationTypes, relationNames } from '../../utils/knowledge';
import { applyTheme } from '../../utils/theme';
Page({
  data: {
    pageId: null as string | null,
    task: '',
    proposal: '',
    loaded: false,
    loading: false,
    content: blank(),
    mode: 'edit',
    blocks: [] as any[],
    links: [] as any[],
    busy: false,
    status: '尚未保存',
    error: '',
    notice: '',
    relationTypes,
    relationNames,
    relationQ: '',
    targets: [] as any[],
    relationIndex: 0,
    otherDraft: null as any,
    latest: null as any,
    done: false,
  },
  _owner: '',
  _key: '',
  _version: 0,
  _saved: '',
  _pending: null as Promise<void> | null,
  _timer: 0 as any,
  _submitId: uuid(),
  _restoreLocal: null as any,
  onLoad(q) {
    this.setData({
      pageId: q.id || null,
      task: q.task || (q.proposal ? 'proposal-' + q.proposal : uuid()),
      proposal: q.proposal || '',
    });
  },
  onShow() {
    applyTheme(this);
    if (this._owner && this._owner !== session()?.actor.userId) {
      wx.redirectTo({ url: '/features/knowledge-editor/index' });
      return;
    }
    if (requireLogin() && !this.data.loaded && !this.data.loading) this.init();
  },
  async init() {
    this._owner = session()!.actor.userId;
    this._key = draftKey('wiki', this.data.task);
    this.setData({ loading: true, error: '' });
    try {
      const result = await api('knowledge/drafts/' + this.data.task),
        local = wx.getStorageSync(this._key);
      const draft = result.draft;
      let initial = blank();
      if (!draft && this.data.proposal) {
        const p = await api('knowledge/proposals/' + this.data.proposal);
        initial = contentOf(p.content);
        this.setData({ pageId: p.pageId });
      } else if (!draft && this.data.pageId) {
        const page = await api('knowledge/pages/' + this.data.pageId);
        initial = { ...contentOf(page), baseRevisionId: page.revisionId, changeNote: '' };
      }
      let content = draft?.content ?? initial;
      this._version = draft?.version ?? 0;
      this._saved = JSON.stringify(contentOf(content));
      if (draft?.pageId) this.setData({ pageId: draft.pageId });
      if (local?.unsynced) {
        if (local.version === this._version) {
          content = local.content;
          this.setData({
            pageId: local.pageId ?? this.data.pageId,
            notice: '已恢复本机未同步稿；将重新尝试同步服务器',
          });
        } else {
          this._restoreLocal = local;
          this.setData({
            otherDraft: { content: local.content },
            notice: '本机未同步内容与服务器草稿不同。两份均保留，可比较后另存。',
          });
        }
      }
      const relations = await Promise.all(
        content.relations.map(async (r: any) => {
          let label = '词条不可用';
          try {
            label = (await api('knowledge/pages/' + r.targetPageId)).title;
          } catch {}
          return { ...r, _title: label };
        }),
      );
      this.setData({
        content: { ...content, relations },
        loaded: true,
        status: draft ? '已恢复服务器草稿' : '尚未保存',
      });
      if (local?.unsynced && local.version === this._version) void this.flush().catch(() => {});
    } catch (e: any) {
      const local = wx.getStorageSync(this._key);
      if (local?.content) {
        this._version = local.version;
        this.setData({
          content: local.content,
          pageId: local.pageId,
          loaded: true,
          notice: '网络暂不可用，已恢复本机内容。联网后请重试同步。',
        });
      }
      this.setData({ error: e.message, status: '加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },
  backup(unsynced = true) {
    if (this._owner !== session()?.actor.userId) return;
    try {
      wx.setStorageSync(this._key, {
        task: this.data.task,
        pageId: this.data.pageId,
        version: this._version,
        content: contentOf(this.data.content),
        unsynced,
        updatedAt: Date.now(),
      });
    } catch {
      this.setData({ error: '本机备份失败，请保留此页面并尽快同步服务器' });
    }
  },
  changed() {
    this._submitId = uuid();
    this.backup();
    this.setData({ status: '仅保存在本机，等待同步' });
    clearTimeout(this._timer);
    this._timer = setTimeout(() => void this.flush().catch(() => {}), 900);
    wx.enableAlertBeforeUnload({ message: '离开前请确认草稿已经保存。' });
  },
  input(e: WechatMiniprogram.CustomEvent) {
    if (this.data.busy) return;
    const field = e.currentTarget.dataset.field;
    if (['title', 'summary', 'markdown', 'changeNote'].includes(field)) {
      this.setData({ ['content.' + field]: e.detail.value });
      this.changed();
    }
  },
  async flush(): Promise<void> {
    if (this._pending) {
      await this._pending;
      return this.flush();
    }
    if (this._owner !== session()?.actor.userId)
      throw new Error('账号已变化，草稿仍保存在原账号下');
    const work = async () => {
      while (this._saved !== JSON.stringify(contentOf(this.data.content))) {
        const content = contentOf(this.data.content),
          serialized = JSON.stringify(content);
        this.setData({ status: '同步中…', error: '' });
        try {
          const r = await api('knowledge/drafts', 'PUT', {
            editingTaskId: this.data.task,
            pageId: this.data.pageId,
            expectedVersion: this._version,
            content,
          });
          this._version = r.version;
          this._saved = serialized;
          this.backup(JSON.stringify(contentOf(this.data.content)) !== serialized);
          this.setData({ status: '已同步至服务器' });
          if (this._saved === JSON.stringify(contentOf(this.data.content)))
            wx.disableAlertBeforeUnload();
        } catch (e: any) {
          this.backup();
          this.setData({
            status:
              e instanceof ApiError && e.code === 'DRAFT_CONFLICT'
                ? '草稿版本冲突'
                : '仅保存在本机，同步失败',
            error: e.message,
          });
          throw e;
        }
      }
    };
    const job = work();
    this._pending = job;
    try {
      await job;
    } finally {
      this._pending = null;
    }
  },
  retry() {
    this.flush().catch(() => {});
  },
  onHide() {
    clearTimeout(this._timer);
    if (this.data.loaded && !this.data.done) this.flush().catch(() => {});
  },
  onUnload() {
    clearTimeout(this._timer);
    if (this.data.loaded && !this.data.done) {
      this.backup(this._saved !== JSON.stringify(contentOf(this.data.content)));
      this.flush().catch(() => {});
    }
  },
  async template(e: WechatMiniprogram.CustomEvent) {
    if (this.data.busy) return;
    const value = ['plain', 'handbook', 'academic'][Number(e.detail.value)];
    if (this.data.content.markdown.trim()) {
      const confirm = await wx.showModal({
        title: '套用内容模板',
        content: '将替换当前正文。保留现有正文时请选择取消。',
      });
      if (!confirm.confirm) return;
    }
    this.setData({ 'content.template': value, 'content.markdown': templates[value] });
    this.changed();
  },
  async preview(e: WechatMiniprogram.CustomEvent) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ mode, error: '' });
    if (mode === 'preview')
      try {
        this.setData(await render(this.data.content.markdown));
      } catch (f: any) {
        this.setData({ error: f.message });
      }
  },
  relationInput(e: WechatMiniprogram.CustomEvent) {
    if (this.data.busy) return;
    this.setData({ relationQ: e.detail.value });
  },
  async searchTargets() {
    try {
      const r = await api('mobile/knowledge-feed?q=' + encodeURIComponent(this.data.relationQ));
      this.setData({ targets: r.items.filter((p: any) => p.id !== this.data.pageId) });
    } catch (e) {
      showError(e);
    }
  },
  relationType(e: WechatMiniprogram.CustomEvent) {
    if (this.data.busy) return;
    this.setData({ relationIndex: Number(e.detail.value) });
  },
  addTarget(e: WechatMiniprogram.CustomEvent) {
    if (this.data.busy) return;
    const p = this.data.targets[Number(e.currentTarget.dataset.index)],
      type = relationTypes[this.data.relationIndex];
    if (this.data.content.relations.some((r) => r.targetPageId === p.id && r.type === type)) {
      showToast('此关系已添加');
      return;
    }
    this.setData({
      'content.relations': [
        ...this.data.content.relations,
        {
          type,
          targetPageId: p.id,
          _title: p.title,
          conditions: '',
          explanation: '',
          evidence: '',
        },
      ],
      targets: [],
      relationQ: '',
    });
    this.changed();
  },
  relationField(e: WechatMiniprogram.CustomEvent) {
    if (this.data.busy) return;
    const field = e.currentTarget.dataset.field;
    if (['conditions', 'explanation', 'evidence'].includes(field)) {
      this.setData({
        ['content.relations[' + Number(e.currentTarget.dataset.index) + '].' + field]:
          e.detail.value,
      });
      this.changed();
    }
  },
  removeRelation(e: WechatMiniprogram.CustomEvent) {
    if (this.data.busy) return;
    this.setData({
      'content.relations': this.data.content.relations.filter(
        (_, i) => i !== Number(e.currentTarget.dataset.index),
      ),
    });
    this.changed();
  },
  async compare() {
    try {
      const r = await api('knowledge/drafts/' + this.data.task);
      this.setData({ otherDraft: r.draft ?? { content: blank() } });
    } catch (e) {
      showError(e);
    }
  },
  async useServer() {
    if (this.data.busy) return;
    const r = await wx.showModal({
      title: '使用服务器草稿',
      content: '当前未同步稿会保留为另一份本机备份，再载入服务器内容。',
    });
    if (!r.confirm) return;
    this.backup();
    wx.setStorageSync(this._key + ':previous', wx.getStorageSync(this._key));
    try {
      const result = await api('knowledge/drafts/' + this.data.task);
      if (!result.draft) throw new Error('服务器尚无此草稿');
      this._version = result.draft.version;
      this._saved = JSON.stringify(result.draft.content);
      this.setData({
        content: result.draft.content,
        otherDraft: null,
        error: '',
        status: '已恢复服务器草稿',
      });
      this.backup(false);
    } catch (e) {
      showError(e);
    }
  },
  async fork() {
    if (this.data.busy) return;
    if (this._restoreLocal) {
      this.setData({ content: this._restoreLocal.content });
      this._restoreLocal = null;
    }
    const task = uuid();
    this.setData({ task, otherDraft: null, error: '' });
    this._key = draftKey('wiki', task);
    this._version = 0;
    this._saved = '';
    this.changed();
    await this.flush().catch(() => {});
  },
  async latest() {
    if (!this.data.pageId) return;
    try {
      this.setData({ latest: await api('knowledge/pages/' + this.data.pageId) });
    } catch (e) {
      showError(e);
    }
  },
  confirmBase() {
    if (this.data.busy) return;
    if (!this.data.latest) return;
    this.setData({
      'content.baseRevisionId': this.data.latest.revisionId,
      latest: null,
      notice: '已确认参考最新版本，请合并所需改动后再提交',
    });
    this.changed();
  },
  async submit() {
    if (this.data.busy || !this.data.content.title.trim() || !this.data.content.markdown.trim())
      return;
    this.setData({ busy: true, error: '' });
    clearTimeout(this._timer);
    try {
      await this.flush();
      if (!this.data.pageId) {
        const r = await api('knowledge/pages', 'POST', {});
        this.setData({ pageId: r.id });
        this._saved = '';
        await this.flush();
      }
      await api('knowledge/pages/' + this.data.pageId + '/submit', 'POST', {
        ...contentOf(this.data.content),
        idempotencyKey: this._submitId,
      });
      this.setData({ done: true, status: '修改已提交审核' });
      wx.disableAlertBeforeUnload();
      try {
        await api('knowledge/drafts/' + this.data.task, 'DELETE');
        wx.removeStorageSync(this._key);
      } catch {
        this.setData({ notice: '修改已经提交，草稿清理待稍后完成。' });
      }
    } catch (e: any) {
      this.setData({ error: e.message });
      if (e instanceof ApiError && e.code === 'REVISION_CONFLICT') await this.latest();
    } finally {
      this.setData({ busy: false });
    }
  },
  manage() {
    wx.redirectTo({ url: '/features/knowledge-manage/index' });
  },
  link(e: WechatMiniprogram.CustomEvent) {
    openContent(e.currentTarget.dataset.url);
  },
});
