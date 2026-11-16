'use client';
import { useState } from 'react';
import type {
  WikiRevisionDto,
  RevisionDiff as Diff,
} from '../../../../../packages/contracts/src/index';
import { RevisionDiff } from './RevisionDiff';
import { WikiArticle } from './WikiArticle';
export function WikiHistory({
  pageId,
  revisions,
  currentId,
  communitySlug,
}: {
  pageId: string;
  revisions: WikiRevisionDto[];
  currentId: string;
  communitySlug: string;
}) {
  const [from, setFrom] = useState(revisions[1]?.id || currentId),
    [to, setTo] = useState(currentId),
    [diff, setDiff] = useState<Diff | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<WikiRevisionDto | null>(null),
    [target, setTarget] = useState<WikiRevisionDto | null>(null);
  async function compare() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        '/api/backend/wiki/' +
          pageId +
          '/diff?fromId=' +
          encodeURIComponent(from) +
          '&toId=' +
          encodeURIComponent(to),
      );
      if (!response.ok) throw new Error('无法读取差异，版本可能已隐藏，请刷新历史。');
      setDiff((await response.json()) as Diff);
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取差异');
    } finally {
      setBusy(false);
    }
  }
  async function rollback() {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/backend/wiki/' + pageId + '/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetRevisionId: target.id,
          baseRevisionId: currentId,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? '词条又有更新，未执行回滚。请刷新后重新比较。'
            : response.status === 401
              ? '请先登录后再回滚。'
              : response.status === 403
                ? '当前账号没有此词条的编辑权限。'
                : '回滚未完成，请重试。',
        );
      window.location.assign('/wiki/' + pageId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '回滚未完成');
    } finally {
      setBusy(false);
    }
  }
  const options = revisions.map((revision, index) => (
    <option value={revision.id} key={revision.id}>
      第 {revisions.length - index} 版 · {revision.changeNote || revision.title}
    </option>
  ));
  return (
    <>
      <section className="panel">
        <div className="compare-controls">
          <label>
            比较起点
            <select aria-label="比较起点" value={from} onChange={(e) => setFrom(e.target.value)}>
              {options}
            </select>
          </label>
          <label>
            比较终点
            <select aria-label="比较终点" value={to} onChange={(e) => setTo(e.target.value)}>
              {options}
            </select>
          </label>
          <button className="primary" disabled={busy} onClick={() => void compare()}>
            比较版本
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {revisions.map((revision, index) => (
          <div key={revision.id} className="revision-row">
            <div>
              <strong>
                第 {revisions.length - index} 版{revision.id === currentId ? ' · 当前版本' : ''}
              </strong>
              <p>{revision.changeNote || '未填写修改说明'}</p>
              <small>
                {revision.authorAlias} · {new Date(revision.createdAt).toLocaleString('zh-CN')}
              </small>
            </div>
            <div>
              <button className="quiet" onClick={() => setPreview(revision)}>
                查看此版
              </button>
              {revision.id !== currentId && (
                <button className="quiet" onClick={() => setTarget(revision)}>
                  回滚到此版
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
      {target && (
        <section className="panel rollback-confirm">
          <h2>确认恢复这份内容？</h2>
          <p className="muted">
            回滚会创建一个新版本，保留所有旧版本。目标：{target.changeNote || target.title}。
          </p>
          <button className="primary" disabled={busy} onClick={() => void rollback()}>
            确认创建回滚版本
          </button>
          <button className="quiet" onClick={() => setTarget(null)}>
            取消
          </button>
        </section>
      )}
      {diff && <RevisionDiff value={diff} />}{' '}
      {preview && (
        <section className="panel">
          <h2>{preview.title} · 历史内容</h2>
          <WikiArticle markdown={preview.markdown} communitySlug={communitySlug} />
        </section>
      )}
    </>
  );
}
