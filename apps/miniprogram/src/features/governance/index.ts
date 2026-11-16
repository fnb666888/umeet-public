import { api, showError, showToast } from '../../utils/api';
import { requireLogin, uuid } from '../../utils/session';
import { applyTheme } from '../../utils/theme';
Page({
  data: {
    tab: 'applications',
    items: [] as any[],
    invitations: [] as any[],
    teams: [] as any[],
    records: [] as any[],
    eligibility: null as any,
    error: '',
    busy: false,
    kind: 'board',
    board: '',
    name: '',
    description: '',
    rules: '文明讨论，提供依据',
    reason: '',
    editing: null as any,
    applicationId: uuid(),
  },
  onShow() {
    applyTheme(this);
    if (requireLogin()) this.load();
  },
  async load() {
    this.setData({ error: '' });
    try {
      const status = await api('governance');
      this.setData({ records: [...(status.actions ?? []), ...(status.reports ?? [])] });
      const [apps, eligible, invitations, teams] = await Promise.all([
        api('community-governance/applications'),
        api('community-governance/eligibility'),
        api('community-governance/moderator-invitations'),
        api('community-governance/teams/mine'),
      ]);
      this.setData({
        items: Array.isArray(apps) ? apps : (apps.items ?? []),
        eligibility: eligible,
        invitations,
        teams: teams.map((t: any) => ({ ...t, id: t.team_id })),
      });
    } catch (e: any) {
      this.setData({ error: e.message });
    }
  },
  input(e: WechatMiniprogram.CustomEvent) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  kind(e: WechatMiniprogram.CustomEvent) {
    this.setData({ kind: ['board', 'moderator', 'assistant'][Number(e.detail.value)] });
  },
  async submit() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const d = this.data;
      const payload = {
        id: d.applicationId,
        kind: 'board',
        board: d.board,
        data: {
          name: d.name,
          description: d.description,
          rules: d.rules.split('\n').filter(Boolean),
          reason: d.reason,
          plan: '',
          experience: '',
          applyModerator: false,
        },
      };
      if (d.editing)
        await api('community-governance/applications/change', 'POST', {
          id: d.editing.id,
          version: d.editing.version,
          action: 'resubmit',
          reason: d.reason,
          data: payload.data,
          permissions: [],
        });
      else await api('community-governance/applications', 'POST', payload);
      this.setData({ editing: null, applicationId: uuid(), name: '', reason: '' });
      showToast('申请已提交');
      await this.load();
    } catch (e: any) {
      this.setData({ error: e.message });
    } finally {
      this.setData({ busy: false });
    }
  },
  async respond(e: WechatMiniprogram.CustomEvent) {
    const d = e.currentTarget.dataset;
    try {
      await api(
        d.team
          ? 'community-governance/teams/respond'
          : 'community-governance/moderator-invitations/respond',
        'POST',
        {
          ...(d.team ? { teamId: d.id } : { id: d.id }),
          version: Number(d.version),
          action: d.action,
        },
      );
      await this.load();
    } catch (f) {
      showError(f);
    }
  },
  revise(e: WechatMiniprogram.CustomEvent) {
    const item = this.data.items[Number(e.currentTarget.dataset.index)];
    this.setData({
      editing: item,
      board: item.board,
      name: item.data.name,
      description: item.data.description,
      rules: item.data.rules.join('\n'),
      reason: item.data.reason,
    });
    wx.pageScrollTo({ selector: '#application-form' });
  },
  async withdraw(e: WechatMiniprogram.CustomEvent) {
    const d = e.currentTarget.dataset;
    try {
      await api('community-governance/applications/change', 'POST', {
        id: d.id,
        version: Number(d.version),
        action: 'withdraw',
        reason: '申请人撤回',
        permissions: [],
      });
      await this.load();
    } catch (f) {
      showError(f);
    }
  },
  async appeal(e: WechatMiniprogram.CustomEvent) {
    const r = await wx.showModal({
      title: '提交申诉',
      editable: true,
      placeholderText: '请说明理由与依据',
    });
    if (!r.confirm || !r.content) return;
    try {
      await api('governance/appeals', 'POST', {
        actionId: e.currentTarget.dataset.id,
        reason: r.content,
      });
      await this.load();
    } catch (f) {
      showError(f);
    }
  },
});
