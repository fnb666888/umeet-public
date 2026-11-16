'use client';
import { navigateCommunity } from '../../lib/community-route';
import { useEffect, useState, type FormEvent } from 'react';
import { governanceRequest, cachedGovernance, governanceResources } from './governance-client';
import { boards } from './model';
import { useCommunity } from './store';
import { permissionLabels } from '../../../../../packages/contracts/src/moderation-permissions';
import { BoardApplication } from './BoardApplication';

export type ApplicationData = {
  name: string;
  description: string;
  rules: string[];
  reason: string;
  plan: string;
  experience: string;
  applyModerator: boolean;
  moderatorReason?: string;
};
export type ApplicationRow = {
  id: string;
  user_id: string;
  nickname: string;
  kind: string;
  board: string;
  state: string;
  data: ApplicationData;
  version: number;
  created_at: string;
  events: { id: string; action: string; reason: string; created_at: string }[];
  eligibility?: Eligibility;
  dispositions?: { id: string; action: string; reason: string; created_at: string }[];
};
export type Eligibility = {
  eligible: boolean;
  registeredDays: number;
  validPosts: number;
  requiredDays: number;
  requiredPosts: number;
  blockReasons: string[];
};
type Invitation = {
  team_id: string;
  name: string;
  board: string;
  state: string;
  version: number;
  permissions: string;
  teamState: string;
};
export const applicationStates: Record<string, string> = {
  pending: '待审核',
  returned: '待补充',
  approved: '已通过',
  rejected: '已拒绝',
  withdrawn: '已撤回',
};
const blank: ApplicationData = {
  name: '',
  description: '',
  rules: [],
  reason: '',
  plan: '',
  experience: '',
  applyModerator: false,
};
const newline = String.fromCharCode(10);

export function ApplicationFields({
  value,
  onChange,
  kind,
}: {
  value: ApplicationData;
  onChange: (value: ApplicationData) => void;
  kind: string;
}) {
  const update = (patch: Partial<ApplicationData>) => onChange({ ...value, ...patch });
  return (
    <>
      {kind === 'board' && (
        <>
          <label>
            板块名称
            <input
              required
              maxLength={40}
              value={value.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <label>
            板块简介
            <textarea
              required
              maxLength={160}
              value={value.description}
              onChange={(event) => update({ description: event.target.value })}
            />
          </label>
          <label>
            基本规则，每行一条
            <textarea
              required
              value={value.rules.join(newline)}
              onChange={(event) => update({ rules: event.target.value.split(newline) })}
            />
          </label>
        </>
      )}
      <label>
        {kind === 'board' ? '开设理由' : '申请理由'}
        <textarea
          required
          maxLength={2000}
          value={value.reason}
          onChange={(event) => update({ reason: event.target.value })}
        />
      </label>
    </>
  );
}

export function CommunityApplications({
  kind,
  board,
}: {
  kind?: 'board' | 'moderator' | 'assistant';
  board?: string;
}) {
  const { toast, refresh } = useCommunity();
  const [rows, setRows] = useState<ApplicationRow[]>(() => cachedGovernance<ApplicationRow[]>('applications') ?? []);
  const [invitations, setInvitations] = useState<Invitation[]>(() => cachedGovernance<Invitation[]>('teams/mine') ?? []);
  const [moderatorInvitations, setModeratorInvitations] = useState<{ id: string; board: string; state: string; version: number; data: string }[]>(() => cachedGovernance('moderator-invitations') ?? []);
  const [eligibility, setEligibility] = useState<Eligibility | null>(() => cachedGovernance<Eligibility>('eligibility') ?? null);
  const [value, setValue] = useState<ApplicationData>(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [editing, setEditing] = useState<ApplicationRow | null>(null);
  const [selected, setSelected] = useState<ApplicationRow | null>(null);
  const [slug, setSlug] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function load() {
    if (kind === 'board') {
      setEligibility(await governanceRequest<Eligibility>('eligibility'));
      return;
    }
    const [requests, teams, qualification, moderatorInvites] = await Promise.all([
      governanceRequest<ApplicationRow[]>('applications'),
      governanceRequest<Invitation[]>('teams/mine'),
      governanceRequest<Eligibility>('eligibility'),
      governanceRequest<typeof moderatorInvitations>('moderator-invitations'),
    ]);
    setRows(requests);
    setInvitations(teams);
    setEligibility(qualification);
    setModeratorInvitations(moderatorInvites);
  }
  useEffect(() => {
    const refreshInvitations = () => void load().catch((error) => setError(error.message));
    refreshInvitations();
    const unsubscribe = governanceResources.subscribe(event => { if (event.type === 'invalidate') refreshInvitations(); });
    window.addEventListener('focus', refreshInvitations);
    return () => { unsubscribe(); window.removeEventListener('focus', refreshInvitations); };
  }, [kind]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
      await refresh();
      toast('操作已完成');
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const data = {
      ...value,
      applyModerator: false,
      name:
        kind !== 'board' && Boolean(kind)
          ? boards.find((item) => item.slug === board)?.name || board || ''
          : value.name,
      rules: value.rules.map((rule) => rule.trim()).filter(Boolean),
    };
    const ok = await run(() =>
      editing
        ? governanceRequest('applications/change', {
            id: editing.id,
            version: editing.version,
            action: 'resubmit',
            reason: '',
            data,
            permissions: [],
          })
        : governanceRequest('applications', {
            id: requestId,
            kind,
            board: kind === 'board' ? slug : board,
            data,
          }),
    );
    if (ok) {
      setRequestId(crypto.randomUUID());
      setEditing(null);
      if (kind === 'board') setSubmitted(true);
      else navigateCommunity('#/my-applications');
    }
  }
  if (kind === 'board') return (
    <BoardApplication
      value={value}
      onChange={setValue}
      slug={slug}
      onSlugChange={setSlug}
      eligibility={eligibility}
      error={error}
      busy={busy}
      submitted={submitted}
      onSubmit={submit}
      onRetry={() => { setError(''); void load().catch((error) => setError(error.message)); }}
    />
  );
  return (
    <section className="governance-page">
      <a className="back" href={kind ? '#/my-applications' : '#/me'}>
        ← {kind ? '我的申请' : '个人中心'}
      </a>
      <h1>
        {kind === 'moderator' ? '申请成为版主' : kind === 'assistant' ? '申请成为助手' : '我的申请'}
      </h1>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {kind || editing ? (
        <>
          <p>
            {eligibility
              ? '注册 ' +
                eligibility.registeredDays +
                ' / ' +
                eligibility.requiredDays +
                ' 天 · 有效发帖 ' +
                eligibility.validPosts +
                ' / ' +
                eligibility.requiredPosts +
                ' 篇'
              : '正在检查资格…'}
          </p>
          {eligibility && !eligibility.eligible && <p>{eligibility.blockReasons.join('，')}</p>}
          <form className="governance-form" onSubmit={submit}>
            <ApplicationFields
              value={value}
              onChange={setValue}
              kind={editing?.kind || kind || 'board'}
            />
            <button className="btn-primary" disabled={busy || !eligibility?.eligible}>
              提交申请
            </button>
          </form>
        </>
      ) : selected ? (
        <>
          <button onClick={() => setSelected(null)}>← 返回申请列表</button>
          <h2>{selected.data.name}</h2>
          <p>{applicationStates[selected.state]}</p>
          <dl>
            <dt>申请理由</dt>
            <dd>{selected.data.reason}</dd>
            {selected.data.plan && (
              <>
                <dt>管理设想</dt>
                <dd>{selected.data.plan}</dd>
              </>
            )}
          </dl>
          <h3>审核记录</h3>
          {selected.events.map((event) => (
            <p key={event.id}>
              {new Date(event.created_at).toLocaleString('zh-CN')} ·{' '}
              {(
                {
                  submitted: '提交申请',
                  approve: '通过',
                  return: '退回补充',
                  reject: '拒绝',
                  withdraw: '撤回',
                  resubmit: '重新提交',
                  recommend: '版主意见',
                } as Record<string, string>
              )[event.action] || event.action}{' '}
              {event.reason}
            </p>
          ))}
          {selected.kind === 'board' && selected.state === 'returned' && (
            <button
              onClick={() => {
                setEditing(selected);
                setValue(selected.data);
                setSelected(null);
              }}
            >
              补充材料
            </button>
          )}
          {['pending', 'returned'].includes(selected.state) && (
            <button
              disabled={busy}
              onClick={() => {
                if (confirm('确认撤回申请？'))
                  void run(() =>
                    governanceRequest('applications/change', {
                      id: selected.id,
                      version: selected.version,
                      action: 'withdraw',
                      reason: '',
                      permissions: [],
                    }),
                  ).then(() => setSelected(null));
              }}
            >
              撤回申请
            </button>
          )}
        </>
      ) : (
        <>
          <div className="governance-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>申请</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>提交时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button onClick={() => setSelected(row)}>{row.data.name}</button>
                    </td>
                    <td>{row.kind === 'board' ? '开设板块' : row.kind === 'assistant' ? '成为助手' : '成为版主'}</td>
                    <td>{applicationStates[row.state]}</td>
                    <td>{new Date(row.created_at).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p>暂无申请</p>}
          </div>
          {moderatorInvitations.length > 0 && <h2>版主邀请</h2>}
          {moderatorInvitations.map(invitation => (
            <section className="governance-membership" key={invitation.id}>
              <h3>{boards.find(board => board.slug === invitation.board)?.name || invitation.board}</h3>
              <p>{(JSON.parse(invitation.data).permissions as string[]).map(permission => permissionLabels[permission as keyof typeof permissionLabels]).filter(Boolean).join('、')}</p>
              {invitation.state === 'pending' ? <div className="admin-actions">
                <button disabled={busy} onClick={() => void run(() => governanceRequest('moderator-invitations/respond', { id: invitation.id, version: invitation.version, action: 'accept' }))}>接受版主邀请</button>
                <button disabled={busy} onClick={() => void run(() => governanceRequest('moderator-invitations/respond', { id: invitation.id, version: invitation.version, action: 'decline' }))}>拒绝版主邀请</button>
              </div> : <p>{{ approved: '已接受', rejected: '已拒绝', withdrawn: '已撤回' }[invitation.state] || invitation.state}</p>}
            </section>
          ))}
          <h2>团队邀请与成员身份</h2>
          {invitations.map((invitation) => (
            <section className="governance-membership" key={invitation.team_id}>
              <h3>{invitation.name}</h3>
              {invitation.teamState === 'suspended' && <p>团队管理权限已暂停</p>}
              <p>
                {boards.find((board) => board.slug === invitation.board)?.name || invitation.board}
              </p>
              <p>
                {(JSON.parse(invitation.permissions) as string[])
                  .map(
                    (permission) => permissionLabels[permission as keyof typeof permissionLabels],
                  )
                  .filter(Boolean)
                  .join('、')}
              </p>
              {invitation.state === 'invited' ? (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        governanceRequest('teams/respond', {
                          teamId: invitation.team_id,
                          version: invitation.version,
                          action: 'accept',
                        }),
                      )
                    }
                  >
                    接受邀请
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        governanceRequest('teams/respond', {
                          teamId: invitation.team_id,
                          version: invitation.version,
                          action: 'decline',
                        }),
                      )
                    }
                  >
                    拒绝邀请
                  </button>
                </>
              ) : invitation.state === 'exit_requested' ? (
                <p>退出申请待确认</p>
              ) : (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      governanceRequest('teams/respond', {
                        teamId: invitation.team_id,
                        version: invitation.version,
                        action: 'request-exit',
                      }),
                    )
                  }
                >
                  申请退出团队
                </button>
              )}
            </section>
          ))}
        </>
      )}
    </section>
  );
}
