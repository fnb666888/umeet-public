'use client';
import { navigateCommunity } from '../../lib/community-route';
import { isContentBoard } from '../../../../../packages/contracts/src/interest';
import { boards } from '../community/model';
import type { ForecastCard, NewsCard } from '../../../../../packages/contracts/src/interest';
import { useInterest } from './api';

type Page<T> = { items: T[]; next: string | null };
type ForecastPage = Page<ForecastCard> & {
  today: { state: string; reason: string; business_day: string };
  fields: { field: string; ready: boolean; reason: string }[];
  score: { resolved: number; brier: number | null };
};
export const fieldNames: Record<string, string> = {
  technology: '科技',
  politics: '政治',
  economics: '经济',
  sports: '比赛',
};
export const forecastStates: Record<string, string> = {
  open: '等待结果',
  review: '待人工核验',
  resolved: '已核验',
  void: '已作废',
};
export function interestTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function queryUrl(tab: string, params: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(params);
  next.delete('tab');
  next.delete('cursor');
  if (value) next.set(key, value);
  else next.delete(key);
  return '#/c/' + tab + (next.size ? '?' + next : '');
}
function Filters({ tab, params }: { tab: string; params: URLSearchParams }) {
  const selected = params.get(tab === 'news' ? 'board' : 'field') || '';
  return (
    <div className="interest-filters">
      <label>
        {tab === 'news' ? '主题' : '领域'}
        <select
          value={selected}
          onChange={(e) => {
            navigateCommunity(queryUrl(
              tab,
              params,
              tab === 'news' ? 'board' : 'field',
              e.target.value,
            ));
          }}
        >
          <option value="">全部</option>
          {(tab === 'news'
            ? boards.filter((b) => !isContentBoard(b.slug)).map((b) => [b.slug, b.name])
            : Object.entries(fieldNames)
          ).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <a
        className={params.get('saved') ? 'on' : ''}
        href={queryUrl(tab, params, 'saved', params.get('saved') ? '' : 'true')}
      >
        已收藏
      </a>
      <a
        className={params.get('followed') ? 'on' : ''}
        href={queryUrl(tab, params, 'followed', params.get('followed') ? '' : 'true')}
      >
        已关注
      </a>
    </div>
  );
}
function pagePath(tab: string, params: URLSearchParams, next: string) {
  const query = new URLSearchParams(params);
  query.delete('tab');
  query.set('cursor', next);
  return '#/c/' + tab + '?' + query;
}
function ListStatus({
  loading,
  error,
  refresh,
}: {
  loading: boolean;
  error: string;
  refresh: () => void;
}) {
  return loading ? (
    <p role="status">正在加载…</p>
  ) : error ? (
    <p role="alert">
      {error}{' '}
      <button className="link-btn" onClick={refresh}>
        重试
      </button>
    </p>
  ) : null;
}
export function NewsList({ params }: { params: URLSearchParams }) {
  const query = new URLSearchParams(params);
  query.delete('tab');
  const result = useInterest<Page<NewsCard>>('news?' + query);
  return (
    <section aria-label="外部资讯">
      <Filters tab="news" params={params} />
      <ListStatus {...result} />
      {result.data && !result.data.items.length && (
        <p className="empty">
          暂无符合条件的资讯。只有已确认来源的新内容会进入这里，不会自动填充旧闻。
        </p>
      )}
      <div className="interest-feed">
        {result.data?.items.map((item) => (
          <article className="interest-card" key={item.id}>
            <div className="interest-meta">
              {boards.find((b) => b.slug === item.board)?.name || item.board} · {item.source} ·{' '}
              {interestTime(item.publishedAt)}
            </div>
            <h2>
              <a href={'#/news/' + item.id}>{item.title}</a>
            </h2>
            {item.summary && <p>{item.summary}</p>}
            <a
              className="interest-source-link"
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              阅读来源原文 ↗
            </a>
          </article>
        ))}
      </div>
      {result.data?.next && (
        <a className="link-btn" href={pagePath('news', params, result.data.next)}>
          更早的资讯
        </a>
      )}
      {params.get('cursor') && (
        <a className="link-btn" href={queryUrl('news', params, 'cursor', '')}>
          返回最新
        </a>
      )}
    </section>
  );
}
export function ForecastList({ params }: { params: URLSearchParams }) {
  const query = new URLSearchParams(params);
  query.delete('tab');
  const result = useInterest<ForecastPage>('forecasts?' + query);
  return (
    <section aria-label="每日预测">
      <p className="muted">
        每天北京时间 08:00 运行，一天一道新题。发布后的概率和理由保持原样，到期追加核验与复盘。
      </p>
      <Filters tab="forecasts" params={params} />
      <ListStatus {...result} />
      {result.data && (
        <>
          <div className="interest-status" role="status">
            {result.data.today.state === 'published'
              ? '今日预测已发布'
              : result.data.today.state === 'paused'
                ? '今日预测暂停，来源或免费预测服务暂不可用。'
                : result.data.today.state === 'running'
                  ? '今日预测正在准备'
                  : '今日预测尚未发布'}
            <span> · 北京时间业务日 {result.data.today.business_day}</span>
          </div>
          <div className="interest-field-status">
            {result.data.fields.map((f) => (
              <span key={f.field} title={f.reason}>
                {fieldNames[f.field]}：{f.ready ? '题型已就绪' : '来源或题型未就绪'}
              </span>
            ))}
          </div>
          {!!result.data.score.resolved && (
            <p className="muted">
              已核验 {result.data.score.resolved} 题 · Brier 分数{' '}
              {result.data.score.brier?.toFixed(3)}（越低越好；少量样本不代表稳定能力）
            </p>
          )}
        </>
      )}
      <div className="interest-feed">
        {result.data?.items.map((item) => (
          <article className="interest-card" key={item.id}>
            <div className="interest-meta">
              {fieldNames[item.field]} · {forecastStates[item.state] || item.state} ·{' '}
              {interestTime(item.createdAt)}
            </div>
            <h2>
              <a href={'#/forecasts/' + item.id}>{item.title}</a>
            </h2>
            <div className="interest-probability">
              {Math.round(item.probability * 100)}%<span>AI 预测概率</span>
            </div>
            <p>{item.reasoning}</p>
            <p className="muted">截止：{interestTime(item.deadline)}</p>
          </article>
        ))}
      </div>
      {result.data && !result.data.items.length && (
        <p className="empty">还没有公开的预测。未就绪或暂停的日期不会生成虚构概率。</p>
      )}
      {result.data?.next && (
        <a className="link-btn" href={pagePath('forecasts', params, result.data.next)}>
          更早的预测
        </a>
      )}
    </section>
  );
}
