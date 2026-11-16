'use client';
import { useEffect, useState } from 'react';
import { governanceRequest, cachedGovernance } from '../community/governance-client';
import { applicationStates, type ApplicationRow } from '../community/CommunityApplications';
import {
  moderationOperations,
  type ModerationPermission,
} from '../../../../../packages/contracts/src/moderation-permissions';

export function ApplicationReviews({
  board,
  onComplete,
}: {
  board?: string;
  onComplete?: () => Promise<void>;
}) {
  const [rows, setRows] = useState<ApplicationRow[]>(() => cachedGovernance<ApplicationRow[]>('applications?' + (board ? 'board=' + board : 'admin=1')) ?? []);
  const [tab, setTab] = useState(board ? 'assistant' : 'board');
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('pending');
  const [reason, setReason] = useState('');
  const [permissions, setPermissions] = useState<ModerationPermission[]>([...moderationOperations]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    setRows(
      await governanceRequest<ApplicationRow[]>(
        'applications?' + (board ? 'board=' + board : 'admin=1'),
      ),
    );
  }
  useEffect(() => {
    setTab(board ? 'assistant' : 'board');
    void load().catch((error) => { setRows([]); setError(error.message); });

    function read() {
      setSelected(new URLSearchParams(location.search).get('application') || '');
    }
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, [board]);
  function open(id: string) {
    const url = new URL(location.href);
    if (id) url.searchParams.set('application', id);
    else url.searchParams.delete('application');
    history.pushState(null, '', url);
    setSelected(id);
    setReason('');
    setPermissions(board ? [] : [...moderationOperations]);
  }
  const row = rows.find((row) => row.id === selected);
  async function review(action: string) {
    setBusy(true);
    setError('');
    try {
      await governanceRequest('applications/change', {
        id: row!.id,
        version: row!.version,
        action,
        reason,
        permissions,
      });
      await load();
      await onComplete?.();
      open('');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={board ? '助手申请' : '申请管理'}>
      <h2>{board ? '助手申请' : '申请管理'}</h2>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {row ? (
        <>
          <button className="admin-back" onClick={() => open('')}>
            ← 返回申请列表
          </button>
          <h3>{row.data.name}</h3>
          <dl className="admin-detail-meta">
            <div>
              <dt>申请人</dt>
              <dd>
                <a href={'/#/users/' + row.user_id}>{row.nickname} ↗</a>
              </dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{applicationStates[row.state]}</dd>
            </div>
            <div>
              <dt>注册</dt>
              <dd>{row.eligibility?.registeredDays} 天</dd>
            </div>
            <div>
              <dt>有效发帖</dt>
              <dd>{row.eligibility?.validPosts} 篇</dd>
            </div>
          </dl>
          <p>{row.eligibility?.blockReasons.join('，')}</p>
          <h3>申请材料</h3>
          <dl>
            {row.data.description && (
              <>
                <dt>板块简介</dt>
                <dd>{row.data.description}</dd>
              </>
            )}
            <dt>申请理由</dt>
            <dd>{row.data.reason}</dd>
            {row.data.rules.length > 0 && (
              <>
                <dt>基本规则</dt>
                <dd>
                  {row.data.rules.map((rule, index) => (
                    <p key={index}>{rule}</p>
                  ))}
                </dd>
              </>
            )}
            {row.data.plan && (
              <>
                <dt>管理设想</dt>
                <dd>{row.data.plan}</dd>
                <dt>过往管理经验</dt>
                <dd>{row.data.experience || '未填写'}</dd>
              </>
            )}
          </dl>
          <h3>审核记录</h3>
          {row.events.map((event) => (
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
          {row.dispositions && (
            <>
              <h3>账号处置历史</h3>
              {row.dispositions.length ? (
                row.dispositions.map((record) => (
                  <p key={record.id}>
                    {new Date(record.created_at).toLocaleString('zh-CN')} ·{' '}
                    {record.reason || '账号处置'}
                  </p>
                ))
              ) : (
                <p>暂无处置记录</p>
              )}
            </>
          )}
          {row.kind === 'board' && ['pending', 'returned'].includes(row.state) && (
            <>
              <hr />
              <label>
                审核意见
                <textarea
                  value={reason}
                  maxLength={2000}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="admin-actions">
                <button
                  disabled={busy || !row.eligibility?.eligible}
                  onClick={() => void review('approve')}
                >
                  通过开板申请
                </button>
                <button disabled={busy || !reason.trim()} onClick={() => void review('return')}>
                  退回补充
                </button>
                <button disabled={busy || !reason.trim()} onClick={() => void review('reject')}>
                  拒绝
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {!board && <nav className="admin-tabs">
            {!board && (
              <button
                aria-current={tab === 'board' ? 'page' : undefined}
                onClick={() => setTab('board')}
              >
                开板申请
              </button>
            )}
            <button
              aria-current={tab === (board ? 'assistant' : 'moderator') ? 'page' : undefined}
              onClick={() => setTab(board ? 'assistant' : 'moderator')}
            >
              {board ? '助手申请' : '版主申请'}
            </button>
          </nav>}
          <form className="admin-toolbar" onSubmit={(event) => event.preventDefault()}>
            <input
              placeholder="搜索板块或申请人"
              aria-label="搜索申请"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              aria-label="申请状态"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">全部状态</option>
              {Object.entries(applicationStates).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </form>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>板块</th>
                  <th>申请人</th>
                  <th>状态</th>
                  <th>提交时间</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter(
                    (row) =>
                      row.kind === tab &&
                      (status === 'all' || row.state === status) &&
                      (row.data.name + ' ' + row.nickname).includes(search),
                  )
                  .map((row) => (
                    <tr key={row.id}>
                      <td>
                        <button onClick={() => open(row.id)}>{row.data.name}</button>
                      </td>
                      <td>{row.nickname}</td>
                      <td>{applicationStates[row.state]}</td>
                      <td>{new Date(row.created_at).toLocaleString('zh-CN')}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
