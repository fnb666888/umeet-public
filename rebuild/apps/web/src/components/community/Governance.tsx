'use client';
import { useEffect, useRef, useState } from 'react';
import type { GovernanceStatus } from '../../../../../packages/contracts/src/admin';
import { reportReasons, reportReasonApplies } from '../../../../../packages/contracts/src/report-reasons';
import { useCommunity } from './store';
import { DispositionEffects } from '../DispositionEffects';

import { dispositionRequest as request, dispositionResources } from './disposition-client';
import { useResource } from '../../lib/use-resource';

export function ReportButton({ target, label = '举报', boards = [] }: {
  target: string;
  label?: string;
  boards?: readonly string[];
}) {
  const { requireLogin, toast, siteSettings } = useCommunity();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const reasons = siteSettings
    ? siteSettings.reportReasons.filter((reason) => reportReasonApplies(reason, boards))
    : Object.entries(reportReasons).map(([id, label]) => ({ id, label }));
  const selected = reasons.some((reason) => reason.id === category) ? category : reasons[0]?.id || '';
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  return (
    <>
      <button
        className="act"
        type="button"
        onClick={() => {
          if (requireLogin()) setOpen(true);
        }}
      >
        {label}
      </button>
      {open && (
        <dialog
          className="governance-dialog"
          ref={dialog}
          onCancel={event => {
            event.preventDefault();
            if (!busy) setOpen(false);
          }}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError('');
              try {
                await request('/reports', { target, category: selected, detail });
                setOpen(false);
                toast('举报已提交，可在设置中查看进度');
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>{label}</h2>
            <p className="muted">请选择具体问题。管理人员会结合内容和社区规则处理。</p>
            <label>
              举报原因
              <select
                value={selected}
                onChange={(event) => setCategory(event.target.value)}
              >
                {reasons.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              补充说明
              <textarea
                value={detail}
                maxLength={1000}
                onChange={(event) => setDetail(event.target.value)}
                placeholder="补充发生了什么，以及需要关注的位置"
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="governance-actions">
              <button type="button" disabled={busy} onClick={() => setOpen(false)}>
                取消
              </button>
              <button className="btn-primary" disabled={busy || !selected}>
                提交举报
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}

const statuses: Record<string, string> = {
  partial: '部分撤销',
  superseded: '已调整',
  pending: '待处理',
  handled: '已处理',
  dismissed: '未认定违规',
  escalated: '已升级全站',
  active: '生效中',
  expired: '已到期',
  revoked: '已解除',
  recorded: '已记录',
  upheld: '维持处置',
  reversed: '已撤销处置',
};
export function GovernanceCenter() {
  const { data: snapshot } = useCommunity();
  const resource = useResource<GovernanceStatus>(dispositionResources, '', () => request<GovernanceStatus>());
  const data = resource.data;
  const [error, setError] = useState('');

  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="set-sec governance-center">
      <h2>举报与申诉</h2>
      {!!snapshot?.postReviews?.length && <>
        <h3>我的首帖审核</h3>
        {snapshot.postReviews.map((item) => <article className="governance-record" key={item.id}>
          <strong>{item.status === 'approved' ? <a href={'#/posts/' + item.id}>{item.title}</a> : item.title}</strong>
          <span>{({ pending: '待审核', approved: '已通过', rejected: '未通过' } as Record<string, string>)[item.status]}</span>
          {item.reason && <p>{item.reason}</p>}
          <small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small>
        </article>)}
      </>}
      {data?.suspended && <p role="status">账号已被限制使用。你可以查看处理原因并提交申诉。</p>}
      {(error || resource.error) && <p role="alert">{error || resource.error}</p>}
      {!data && !error && !resource.error && <p>正在加载…</p>}
      <h3>我的管理记录</h3>
      {data && !data.actions.length && <p className="muted">暂无管理记录</p>}
      {data?.actions.map((item) => (
        <article key={item.id} className="governance-record">
          <strong>{item.title}</strong>
          <span>{statuses[item.status] || item.status}</span>
          <p>{item.reason}</p>
          {!!item.effects?.length && <DispositionEffects effects={item.effects} />}
          <small>
            {new Date(item.createdAt).toLocaleString('zh-CN')}
            {item.until ? ' · 到期 ' + new Date(item.until).toLocaleString('zh-CN') : ''}
          </small>
          {item.appeal ? (
            <p>
              申诉进度 · {statuses[item.appeal.status] || item.appeal.status}
              {item.appeal.resolution && ' · ' + item.appeal.resolution}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSelected(item.actionId!);
                setReason('');
              }}
            >
              提交申诉
            </button>
          )}
          {selected === item.actionId && !item.appeal && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                try {
                  await request('/appeals', { actionId: selected, reason });
                  setSelected('');
                  resource.reload();
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                申诉说明
                <textarea
                  required
                  minLength={2}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <button type="button" disabled={busy} onClick={() => setSelected('')}>
                取消
              </button>
              <button disabled={busy}>提交复核</button>
            </form>
          )}
        </article>
      ))}
      <h3>我的举报</h3>
      {data && !data.reports.length && <p className="muted">暂无举报记录</p>}
      {data?.reports.map((item) => (
        <article key={item.id} className="governance-record">
          <strong>{item.title}</strong>
          <span>{statuses[item.status] || item.status}</span>
          <p>{item.reason}</p>
          <small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small>
        </article>
      ))}
    </section>
  );
}
