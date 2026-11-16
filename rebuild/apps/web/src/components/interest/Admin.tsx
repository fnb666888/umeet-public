'use client';
import { useState } from 'react';
import type { ForecastCard } from '../../../../../packages/contracts/src/interest';
import { interestApi, useInterest } from './api';
import { boards } from '../community/model';
import { fieldNames, interestTime } from './Discover';
import './interest.css';

type Source = {
  id: string;
  name: string;
  board: string;
  kind: string;
  url: string;
  terms_url: string;
  enabled: number;
  approved: number;
  last_error: string;
  fetched_at: string | null;
};
type Template = {
  id: string;
  name: string;
  field: string;
  board: string;
  source_id: string;
  target: string;
  days_ahead: number;
  enabled: number;
};
type Report = {
  commentBody: string | null;
  commentHidden: boolean;
  id: string;
  target_type: string;
  target_id: string;
  comment_id: string | null;
  reason: string;
  state: string;
  resolution: string;
  title: string;
  board: string;
};
type AdminData = {
  canConfigure: boolean;
  sources: Source[];
  templates: Template[];
  days: { business_day: string; state: string; reason: string }[];
  reports: Report[];
  forecasts: ForecastCard[];
  provider: { ready: boolean; reason: string; model?: string };
  allowedSourceHosts: string[];
};
const blankSource = {
  id: '',
  name: '',
  board: 'opensource',
  kind: 'github',
  url: '',
  termsUrl: '',
  enabled: false,
  approved: false,
};
const blankTemplate = {
  id: '',
  name: '',
  field: 'technology',
  board: 'opensource',
  sourceId: '',
  target: '',
  daysAhead: 7,
  enabled: false,
};
export function InterestAdmin() {
  const result = useInterest<AdminData>('admin');
  const [source, setSource] = useState(blankSource),
    [template, setTemplate] = useState(blankTemplate),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [resolveId, setResolveId] = useState(''),
    [outcome, setOutcome] = useState('1'),
    [reason, setReason] = useState(''),
    [evidenceUrl, setEvidenceUrl] = useState('');
  async function send(path: string, body: unknown) {
    setBusy(true);
    setMessage('');
    try {
      await interestApi(path, body);
      setMessage('已保存');
      result.refresh();
      return true;
    } catch (e) {
      setMessage((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (result.loading) return <p role="status">正在加载资讯与预测管理…</p>;
  if (result.error || !result.data)
    return (
      <p role="alert">
        {result.error || '管理数据不可用'} <button onClick={result.refresh}>重试</button>
      </p>
    );
  const data = result.data;
  return (
    <section className="interest-admin" aria-label="资讯与预测管理">
      <h1>资讯与预测</h1>
      {message && (
        <p role="status" className="admin-feedback">
          {message}
        </p>
      )}
      {data.canConfigure && (
        <>
          <section className="interest-admin-card">
            <h2>运行状态</h2>
            <p>
              免费预测模型：
              {data.provider.ready ? '已配置 ' + (data.provider.model || '') : '未启用'}
            </p>
            {!data.provider.ready && (
              <p className="muted">{data.provider.reason}。正常社区功能与资讯采集仍可独立运行。</p>
            )}
            <p>来源、题型和免费额度不足时会明确暂停，不生成虚构预测。</p>
            <button
              className="quiet"
              disabled={
                busy ||
                !data.days.some(
                  (d) =>
                    d.state === 'paused' &&
                    d.business_day ===
                      new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
                )
              }
              onClick={() => void send('admin/retry', {})}
            >
              重试今日已暂停任务
            </button>
            {data.days.slice(0, 7).map((day) => (
              <p className="muted" key={day.business_day}>
                {day.business_day} · {day.state} {day.reason}
              </p>
            ))}
          </section>
          <section className="interest-admin-card">
            <h2>资讯来源白名单</h2>
            <p className="muted">
              默认只展示允许的元数据与来源摘要。来源接口公开不等于有全文转载授权。服务器允许的域名：
              {data.allowedSourceHosts.join('、')}
            </p>
            {!data.sources.length && <p>尚未配置来源。</p>}
            {data.sources.map((s) => (
              <div key={s.id} className="interest-admin-card">
                <strong>{s.name}</strong>
                <p>
                  {boards.find((b) => b.slug === s.board)?.name} · {s.enabled ? '启用' : '暂停'} ·{' '}
                  {s.approved ? '展示条件已确认' : '待确认'}
                </p>
                <small>
                  {s.fetched_at ? '最近成功 ' + interestTime(s.fetched_at) : '尚未成功采集'}{' '}
                  {s.last_error}
                </small>
                <div className="interest-actions">
                  <button
                    className="quiet"
                    onClick={() =>
                      setSource({
                        id: s.id,
                        name: s.name,
                        board: s.board,
                        kind: s.kind,
                        url: s.url,
                        termsUrl: s.terms_url,
                        enabled: !!s.enabled,
                        approved: !!s.approved,
                      })
                    }
                  >
                    编辑来源
                  </button>
                  <a href={s.terms_url} target="_blank" rel="noreferrer noopener">
                    查看使用条件
                  </a>
                </div>
              </div>
            ))}
            <details open={!data.sources.length}>
              <summary>新增或编辑来源</summary>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await send('admin/sources', source)) setSource(blankSource);
                }}
              >
                <div className="interest-admin-grid">
                  <label>
                    来源标识
                    <input
                      required
                      pattern="[a-zA-Z0-9_-]{1,80}"
                      value={source.id}
                      onChange={(e) => setSource({ ...source, id: e.target.value })}
                    />
                  </label>
                  <label>
                    来源名称
                    <input
                      required
                      maxLength={100}
                      value={source.name}
                      onChange={(e) => setSource({ ...source, name: e.target.value })}
                    />
                  </label>
                  <label>
                    主要板块
                    <select
                      value={source.board}
                      onChange={(e) => setSource({ ...source, board: e.target.value })}
                    >
                      {boards.map((b) => (
                        <option value={b.slug} key={b.slug}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    接口类型
                    <select
                      value={source.kind}
                      onChange={(e) => setSource({ ...source, kind: e.target.value })}
                    >
                      <option value="github">GitHub 正式发布信息</option>
                      <option value="jsonfeed">JSON Feed</option>
                      <option value="rss">RSS / Atom</option>
                    </select>
                  </label>
                </div>
                <label>
                  接口地址
                  <input
                    required
                    type="url"
                    placeholder="https://api.github.com/repos/组织/项目/releases"
                    value={source.url}
                    onChange={(e) => setSource({ ...source, url: e.target.value })}
                  />
                </label>
                <label>
                  来源使用条件或展示授权说明地址
                  <input
                    required
                    type="url"
                    value={source.termsUrl}
                    onChange={(e) => setSource({ ...source, termsUrl: e.target.value })}
                  />
                </label>
                <div className="interest-choices">
                  <label>
                    <input
                      type="checkbox"
                      checked={source.approved}
                      onChange={(e) =>
                        setSource({
                          ...source,
                          approved: e.target.checked,
                          enabled: e.target.checked && source.enabled,
                        })
                      }
                    />
                    已核对该来源及当前展示内容的使用条件
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      disabled={!source.approved}
                      checked={source.enabled}
                      onChange={(e) => setSource({ ...source, enabled: e.target.checked })}
                    />
                    启用采集
                  </label>
                </div>
                <button className="quiet" disabled={busy}>
                  保存来源
                </button>
              </form>
            </details>
          </section>
          <section className="interest-admin-card">
            <h2>预测题型</h2>
            <p className="muted">
              首个适配器核验指定 GitHub tag
              的正式发布。政治、经济和赛事题型在对应来源与判定适配器接通前保持未就绪。
            </p>
            {data.templates.map((t) => (
              <p key={t.id}>
                {t.name} · {t.target} · {t.enabled ? '启用' : '暂停'}{' '}
                <button
                  className="quiet"
                  onClick={() =>
                    setTemplate({
                      id: t.id,
                      name: t.name,
                      field: t.field,
                      board: t.board,
                      sourceId: t.source_id,
                      target: t.target,
                      daysAhead: t.days_ahead,
                      enabled: !!t.enabled,
                    })
                  }
                >
                  编辑
                </button>
              </p>
            ))}
            <details>
              <summary>新增或编辑版本发布题</summary>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await send('admin/templates', template)) setTemplate(blankTemplate);
                }}
              >
                <div className="interest-admin-grid">
                  <label>
                    题型标识
                    <input
                      value={template.id}
                      onChange={(e) => setTemplate({ ...template, id: e.target.value })}
                      required
                      pattern="[a-zA-Z0-9_-]{1,80}"
                    />
                  </label>
                  <label>
                    项目名称
                    <input
                      value={template.name}
                      onChange={(e) => setTemplate({ ...template, name: e.target.value })}
                      required
                      maxLength={100}
                    />
                  </label>
                  <label>
                    官方版本来源
                    <select
                      required
                      value={template.sourceId}
                      onChange={(e) => setTemplate({ ...template, sourceId: e.target.value })}
                    >
                      <option value="">选择来源</option>
                      {data.sources
                        .filter((s) => s.kind === 'github')
                        .map((s) => (
                          <option value={s.id} key={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    关联板块
                    <select
                      value={template.board}
                      onChange={(e) => setTemplate({ ...template, board: e.target.value })}
                    >
                      {boards.map((b) => (
                        <option value={b.slug} key={b.slug}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    尚未发布的精确 tag
                    <input
                      required
                      maxLength={100}
                      value={template.target}
                      onChange={(e) => setTemplate({ ...template, target: e.target.value })}
                    />
                  </label>
                  <label>
                    未来多少天截止
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={template.daysAhead}
                      onChange={(e) =>
                        setTemplate({ ...template, daysAhead: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
                <div className="interest-choices">
                  <label>
                    <input
                      type="checkbox"
                      checked={template.enabled}
                      onChange={(e) => setTemplate({ ...template, enabled: e.target.checked })}
                    />
                    启用题型
                  </label>
                </div>
                <button className="quiet" disabled={busy}>
                  保存题型
                </button>
              </form>
            </details>
          </section>
          <section className="interest-admin-card">
            <h2>结果核验</h2>
            {!data.forecasts.length && <p className="muted">暂无等待结果的预测。</p>}
            {data.forecasts.map((f) => (
              <div key={f.id} className="interest-admin-card">
                <a href={'/#/forecasts/' + f.id}>{f.title}</a>
                <p>
                  {fieldNames[f.field]} · 截止 {interestTime(f.deadline)} ·{' '}
                  {f.state === 'review' ? '待人工核验' : '等待结果'}
                </p>
                <button
                  className="quiet"
                  onClick={() => {
                    setResolveId(f.id);
                    setReason('');
                    setEvidenceUrl('');
                  }}
                >
                  核验或作废
                </button>
              </div>
            ))}
            {resolveId && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await send('admin/resolve/' + resolveId, {
                      state: outcome === 'void' ? 'void' : 'resolved',
                      outcome: outcome === 'void' ? null : Number(outcome),
                      reason,
                      evidence: evidenceUrl ? [{ title: '人工核验依据', url: evidenceUrl }] : [],
                    })
                  )
                    setResolveId('');
                }}
              >
                <label>
                  判定
                  <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                    <option value="1">事件发生</option>
                    <option value="0">事件未发生</option>
                    <option value="void">题目作废</option>
                  </select>
                </label>
                <label>
                  核验理由
                  <textarea
                    required
                    minLength={5}
                    maxLength={3000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label>
                  公开核验来源
                  <input
                    type="url"
                    required={outcome !== 'void'}
                    value={evidenceUrl}
                    onChange={(e) => setEvidenceUrl(e.target.value)}
                  />
                </label>
                <div className="interest-actions">
                  <button className="quiet" disabled={busy}>
                    确认并保留核验记录
                  </button>
                  <button className="quiet" type="button" onClick={() => setResolveId('')}>
                    取消
                  </button>
                </div>
              </form>
            )}
          </section>
        </>
      )}
      <section className="interest-admin-card">
        <h2>资讯与预测举报</h2>
        {!data.reports.length && <p>暂无相关举报。</p>}
        {data.reports.map((report) => (
          <div key={report.id} className="interest-admin-card">
            <a
              href={
                '/#/' +
                (report.target_type === 'news' ? 'news' : 'forecasts') +
                '/' +
                report.target_id
              }
            >
              {report.title}
            </a>
            <p>{report.reason}</p>
            {report.commentBody && (
              <blockquote>
                <small>被举报评论{report.commentHidden ? '（已隐藏）' : ''}</small>
                <p>{report.commentBody}</p>
              </blockquote>
            )}
            <small>{report.state === 'pending' ? '待处理' : report.resolution}</small>
            <ModerationControls
              busy={busy}
              onAction={(hidden, reason) =>
                send('admin/moderate', {
                  targetType: report.comment_id ? 'comment' : report.target_type,
                  targetId: report.comment_id || report.target_id,
                  hidden,
                  reason,
                })
              }
            />
          </div>
        ))}
      </section>
    </section>
  );
}
function ModerationControls({
  busy,
  onAction,
}: {
  busy: boolean;
  onAction: (hidden: boolean, reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <label>
        处理理由
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={2}
          maxLength={1000}
        />
      </label>
      <div className="interest-actions">
        <button
          className="quiet"
          disabled={busy || reason.trim().length < 2}
          onClick={() => void onAction(true, reason)}
        >
          隐藏举报对象
        </button>
        <button
          className="quiet"
          disabled={busy || reason.trim().length < 2}
          onClick={() => void onAction(false, reason)}
        >
          恢复举报对象
        </button>
      </div>
    </form>
  );
}
