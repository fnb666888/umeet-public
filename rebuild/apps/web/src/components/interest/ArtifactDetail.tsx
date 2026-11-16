'use client';
import { useRef, useState } from 'react';
import type {
  ArtifactDetail as Detail,
  ArtifactKind,
  ForecastCard,
  NewsCard,
} from '../../../../../packages/contracts/src/interest';
import { useCommunity } from '../community/store';
import { interestApi, useInterest } from './api';
import { fieldNames, forecastStates, interestTime } from './Discover';

export function ArtifactDetail({ kind, id }: { kind: ArtifactKind; id: string }) {
  const { data: community, requireLogin, toast } = useCommunity();
  const result = useInterest<Detail>(`items/${kind}/${id}`);
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [report, setReport] = useState(''),
    [reportTarget, setReportTarget] = useState('');
  const requestId = useRef(crypto.randomUUID());
  async function action(value: 'save' | 'follow', active: boolean) {
    if (!requireLogin()) return;
    setBusy(true);
    try {
      await interestApi(`items/${kind}/${id}/actions`, { kind: value, active });
      result.refresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (result.loading) return <p role="status">正在加载…</p>;
  if (result.error || !result.data)
    return (
      <div className="empty" role="alert">
        {result.error || '内容不可用'}{' '}
        <button onClick={result.refresh} className="link-btn">
          重试
        </button>
      </div>
    );
  const detail = result.data,
    item = detail.item,
    forecast = kind === 'forecast' ? (item as ForecastCard) : null,
    news = kind === 'news' ? (item as NewsCard) : null;
  return (
    <article className="interest-detail">
      <a className="back" href={'#/c/' + (kind === 'news' ? 'news' : 'forecasts')}>
        ← 返回{kind === 'news' ? '资讯' : '预测'}
      </a>
      <div className="interest-meta">
        {news ? news.source : fieldNames[forecast!.field]} ·{' '}
        {interestTime(news?.publishedAt || forecast!.createdAt)}
      </div>
      <h1>{item.title}</h1>
      {news && (
        <>
          {news.summary && <p className="interest-summary">{news.summary}</p>}
          <a
            className="interest-source-link"
            href={news.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            阅读来源原文 ↗
          </a>
          <p className="muted">这里展示来源信息，社区评论不代表原发布者的观点。</p>
        </>
      )}
      {forecast && (
        <>
          <div className="interest-probability">
            {Math.round(forecast.probability * 100)}%<span>AI 预测概率 · 发布后固定</span>
          </div>
          <p className="muted">
            信息截至 {interestTime(forecast.informationAt)} · 截止 {interestTime(forecast.deadline)}
          </p>
          <h2>预测理由</h2>
          <p className="interest-whitespace">{forecast.reasoning}</p>
          <h2>反证与不确定性</h2>
          <p>{forecast.counterEvidence}</p>
          <h2>证据来源</h2>
          <ul>
            {forecast.evidence.map((e) => (
              <li key={e.id}>
                <a href={e.url} target="_blank" rel="noreferrer noopener">
                  {e.title}
                </a>
                <p className="muted">{e.excerpt}</p>
              </li>
            ))}
          </ul>
          <details>
            <summary>查看预定判定规则</summary>
            <p>{forecast.rules}</p>
          </details>
          <section className="interest-status">
            <h2>{forecastStates[forecast.state] || forecast.state}</h2>
            <p>{forecast.resolution || '事件到期后按预定来源核验；来源冲突时等待人工复核。'}</p>
            {forecast.outcome !== null && (
              <p>
                结果：{forecast.outcome === 1 ? '发生' : '未发生'} · Brier 分数{' '}
                {forecast.brier?.toFixed(3)}
              </p>
            )}
            {forecast.resultEvidence.map((e) => (
              <p key={e.id}>
                <a href={e.url} target="_blank" rel="noreferrer noopener">
                  {e.title}
                </a>{' '}
                · {e.excerpt}
              </p>
            ))}
          </section>
        </>
      )}
      <div className="interest-actions">
        <button
          className="btn-ghost"
          disabled={busy}
          aria-pressed={detail.saved}
          onClick={() => void action('save', !detail.saved)}
        >
          {detail.saved ? '取消收藏' : '收藏'}
        </button>
        <button
          className="btn-ghost"
          disabled={busy}
          aria-pressed={detail.followed}
          onClick={() => void action('follow', !detail.followed)}
        >
          {detail.followed ? '取消关注' : '关注'}
        </button>
        <button
          className="link-btn"
          onClick={() =>
            void navigator.clipboard
              .writeText(location.href)
              .then(() => toast('链接已复制'))
              .catch(() => toast('请复制地址栏链接分享'))
          }
        >
          复制链接
        </button>
        <button
          className="link-btn"
          onClick={() => {
            if (requireLogin()) {
              setReportTarget('item');
              setReport('');
            }
          }}
        >
          举报
        </button>
      </div>
      <section aria-label="讨论">
        <h2>讨论</h2>
        {!detail.comments.length && (
          <p className="muted">还没有评论，欢迎补充资料或提出不同看法。</p>
        )}
        {detail.comments.map((comment) => (
          <article className="interest-comment" key={comment.id}>
            <div className="interest-meta">
              {comment.author} · {interestTime(comment.createdAt)}
            </div>
            <p className="interest-whitespace">{comment.body}</p>
            {!comment.hidden && (
              <button
                className="link-btn"
                onClick={() => {
                  if (requireLogin()) {
                    setReportTarget(comment.id);
                    setReport('');
                  }
                }}
              >
                举报评论
              </button>
            )}
          </article>
        ))}
        {detail.comments.length === 100 && <p className="muted">当前显示最近 100 条评论。</p>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!requireLogin()) return;
            setBusy(true);
            try {
              await interestApi(`items/${kind}/${id}/comments`, {
                id: requestId.current,
                body: text,
              });
              requestId.current = crypto.randomUUID();
              setText('');
              result.refresh();
            } catch (error) {
              toast((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            发表评论
            <textarea
              maxLength={4000}
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              placeholder={
                community?.actor?.kind === 'member' ? '补充你的理由或资料' : '登录后参与讨论'
              }
            />
          </label>
          <button className="btn-primary" disabled={busy}>
            发布评论
          </button>
        </form>
      </section>
      {reportTarget && (
        <form
          className="interest-status"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await interestApi(`items/${kind}/${id}/reports`, {
                reason: report,
                ...(reportTarget === 'item' ? {} : { commentId: reportTarget }),
              });
              setReportTarget('');
              toast('举报已提交');
            } catch (error) {
              toast((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            举报原因
            <textarea
              value={report}
              onChange={(e) => setReport(e.target.value)}
              required
              minLength={2}
              maxLength={1000}
            />
          </label>
          <div className="interest-actions">
            <button className="btn-primary" disabled={busy}>
              提交举报
            </button>
            <button type="button" className="link-btn" onClick={() => setReportTarget('')}>
              取消
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
