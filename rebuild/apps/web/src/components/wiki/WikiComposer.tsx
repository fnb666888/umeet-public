'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  WikiRevisionDto,
  SaveRevisionInput,
} from '../../../../../packages/contracts/src/index';
import { WikiEditor } from './WikiEditor';
import { ConflictResolver } from './ConflictResolver';
type Props = { communityId: string; communitySlug: string; initial?: WikiRevisionDto };
export function WikiComposer({ communityId, communitySlug, initial }: Props) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [title, setTitle] = useState(initial?.title || ''),
    [slug, setSlug] = useState(''),
    [markdown, setMarkdown] = useState(initial?.markdown || ''),
    [note, setNote] = useState(''),
    [base, setBase] = useState<string | null>(initial?.id || null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState<WikiRevisionDto | null>(null),
    [status, setStatus] = useState('');
  const pending = useRef<{ signature: string; input: SaveRevisionInput } | null>(null);
  async function save() {
    if (!title.trim() || !markdown.trim() || (!initial && !slug.trim())) {
      setError('请填写标题、正文和词条标识。');
      return;
    }
    setBusy(true);
    setError('');
    setStatus('正在提交…');
    const values = { title: title.trim(), markdown, baseRevisionId: base, changeNote: note };
    const signature = JSON.stringify({ ...values, slug });
    if (pending.current?.signature !== signature)
      pending.current = { signature, input: { ...values, idempotencyKey: crypto.randomUUID() } };
    try {
      const response = await fetch('/api/backend/wiki' + (initial ? '/' + initial.pageId : ''), {
        method: initial ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          initial
            ? pending.current.input
            : { communityId, slug, initialRevision: pending.current.input },
        ),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        if (
          response.status === 409 &&
          data &&
          typeof data === 'object' &&
          'code' in data &&
          data.code === 'WIKI_REVISION_CONFLICT' &&
          initial
        ) {
          const latest = await fetch('/api/backend/wiki/' + initial.pageId);
          if (!latest.ok) throw new Error('无法读取最新版，你的修改仍保留在页面中。');
          setConflict((await latest.json()) as WikiRevisionDto);
          setStatus('');
          return;
        }
        const code =
          data && typeof data === 'object' && 'message' in data ? String(data.message) : '';
        throw new Error(
          response.status === 401
            ? '请先登录，当前输入仍保留。'
            : response.status === 403
              ? '游客需要升级账号才能共建；受保护词条需要对应社区管理权限。'
              : code === 'WIKI_SLUG_UNAVAILABLE'
                ? '这个社区已经有相同标识的词条，请修改标识。'
                : code === 'UNSAFE_MARKDOWN'
                  ? '正文含不支持或不安全的内容，请调整源码后再保存。'
                  : '未能保存，请保留内容后重试。',
        );
      }
      if (
        !data ||
        typeof data !== 'object' ||
        !('pageId' in data) ||
        typeof data.pageId !== 'string'
      )
        throw new Error('保存响应无效，请保留输入后重试。');
      window.location.assign('/wiki/' + encodeURIComponent(data.pageId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '未能保存，请重试。');
      setStatus('');
    } finally {
      setBusy(false);
    }
  }
  async function saveDraft() {
    setError('');
    setStatus('正在保存草稿…');
    try {
      const key = initial?.pageId || 'new-wiki-' + communityId;
      const response = await fetch('/api/backend/records/draft/' + encodeURIComponent(key), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: markdown }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? '请先登录或使用游客身份，输入仍保留。'
            : '草稿保存失败，请保留输入后重试。',
        );
      setStatus('草稿已保存，可在我的记录中查看。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '草稿保存失败');
      setStatus('');
    }
  }
  return (
    <>
      <a className="text-link" href={'/c/' + communitySlug + '/wiki'}>
        返回社区 Wiki
      </a>
      <section className="panel wiki-compose">
        <fieldset disabled={!ready} className="compose-fields">
          <label className="record-label">
            词条标题
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              required
            />
          </label>
          {!initial && (
            <label className="record-label">
              词条标识
              <input
                aria-label="词条标识"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                maxLength={160}
                placeholder="中文、字母、数字、下划线或短横线"
              />
              <small>用于社区内链接，例如 [[{slug || '词条标识'}]]。</small>
            </label>
          )}
          {ready && (
            <WikiEditor
              key={base || 'new'}
              value={markdown}
              onChange={setMarkdown}
              onUnsupported={setError}
            />
          )}
          <label className="record-label">
            修改说明
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="简单描述这次补充或修正"
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <p role="status" className="muted">
            {status}
          </p>
          <div className="compose-actions">
            <button className="primary" disabled={busy || !!conflict} onClick={() => void save()}>
              {busy ? '正在保存…' : initial ? '保存新版本' : '发布词条'}
            </button>
            <button className="quiet" disabled={busy} onClick={() => void saveDraft()}>
              保存私人草稿
            </button>
            <span className="muted">普通编辑立即公开，并保留版本历史。</span>
          </div>
        </fieldset>
      </section>
      {conflict && (
        <ConflictResolver
          key={conflict.id}
          latest={conflict}
          mine={markdown}
          mineTitle={title}
          onResolve={(title, value, baseId) => {
            setTitle(title);
            setMarkdown(value);
            setBase(baseId);
            setConflict(null);
            pending.current = null;
            setStatus('已载入合并结果，请检查后保存新版本。');
          }}
        />
      )}
    </>
  );
}
