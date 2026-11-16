'use client';
import { useEffect, useRef, useState } from 'react';
import { recordLink } from '../lib/record-link';
import type {
  PersonalRecordDto,
  PersonalRecordKind,
} from '../../../../packages/contracts/src/index';
type Records = { items: PersonalRecordDto[]; nextCursor: string | null };
function RecordPreview({ value }: { value: string }) {
  const link = recordLink(value);
  return link ? (
    <a className="record-destination" href={link.href}>
      {link.title}
    </a>
  ) : (
    <p>{value.slice(0, 250)}</p>
  );
}
export function PersonalRecords({ initialKind = 'draft' }: { initialKind?: PersonalRecordKind }) {
  const dirty = useRef(false);
  const [authVersion, setAuthVersion] = useState(0);
  useEffect(() => {
    function changed(event: Event) {
      const detail: unknown = event instanceof CustomEvent ? event.detail : null;
      if (
        detail &&
        typeof detail === 'object' &&
        'action' in detail &&
        detail.action === 'logout'
      ) {
        dirty.current = false;
        setDraft('');
        setRecordKey('personal-note');
      } else if (
        dirty.current &&
        detail &&
        typeof detail === 'object' &&
        'identityChanged' in detail &&
        detail.identityChanged
      )
        setRecordKey(crypto.randomUUID());
      setRecords({ items: [], nextCursor: null });
      setAuthVersion((version) => version + 1);
    }
    window.addEventListener('umeet:auth-changed', changed);
    return () => window.removeEventListener('umeet:auth-changed', changed);
  }, []);
  const [kind, setKind] = useState<PersonalRecordKind>(initialKind),
    [records, setRecords] = useState<Records>({ items: [], nextCursor: null }),
    [draft, setDraft] = useState(''),
    [recordKey, setRecordKey] = useState('personal-note'),
    [status, setStatus] = useState('正在读取…'),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  async function load(
    selected: PersonalRecordKind,
    after?: string,
    signal?: AbortSignal,
    preserveDraft = false,
  ) {
    const response = await fetch(
      '/api/backend/records?kind=' +
        selected +
        (after ? '&after=' + encodeURIComponent(after) : ''),
      { ...(signal ? { signal } : {}) },
    );
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? '请通过右上角登录，或选择游客身份后保存记录。'
          : '暂时无法读取记录，请稍后重试。',
      );
    const value = (await response.json()) as Records;
    if (signal?.aborted) return;
    setRecords((old) =>
      after ? { items: [...old.items, ...value.items], nextCursor: value.nextCursor } : value,
    );
    if (selected === 'draft' && !after && !preserveDraft && !dirty.current) {
      const first = value.items[0];
      setRecordKey(first?.key || 'personal-note');
      setDraft(first?.value || '');
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setRecords({ items: [], nextCursor: null });
    setError('');
    setStatus('正在读取…');
    void load(kind, undefined, controller.signal)
      .then(() => setStatus(''))
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : '读取失败');
        setStatus('');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [kind, authVersion]);
  async function save() {
    setBusy(true);
    setError('');
    setStatus('正在保存…');
    try {
      const response = await fetch('/api/backend/records/draft/' + encodeURIComponent(recordKey), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: draft }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? '请先登录或选择游客身份，输入内容仍保留在页面中。'
            : '草稿未保存，请保留内容后重试。',
        );
      dirty.current = false;
      await load('draft', undefined, undefined, true);
      setStatus('已保存到当前账号');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
      setStatus('');
    } finally {
      setBusy(false);
    }
  }
  async function removeBookmark(key: string) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const response = await fetch('/api/backend/records/bookmark/' + encodeURIComponent(key), {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('未能取消收藏，请稍后重试。');
      await load('bookmark');
      setStatus('已取消收藏');
    } catch {
      setError('暂时无法更新收藏，请刷新后确认。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="records-page">
      <nav className="record-tabs" aria-label="记录分类">
        {(['draft', 'bookmark', 'history'] as const).map((tab, i) => (
          <button
            key={tab}
            aria-pressed={kind === tab}
            disabled={busy || loading}
            onClick={() => setKind(tab)}
          >
            {['草稿', '收藏', '浏览记录'][i]}
          </button>
        ))}
      </nav>
      {error && (
        <p className="panel error" role="alert">
          {error}
        </p>
      )}
      <p role="status" className="muted">
        {status}
      </p>
      {kind === 'draft' && (
        <section className="panel">
          <div className="editor-heading">
            <h2>私人草稿</h2>
            <button
              className="quiet"
              disabled={busy || loading}
              onClick={() => {
                setRecordKey(crypto.randomUUID());
                setDraft('');
                dirty.current = true;
                setStatus('新的草稿，尚未保存');
              }}
            >
              新建草稿
            </button>
          </div>
          <label className="record-label">
            草稿内容
            <textarea
              aria-label="草稿内容"
              disabled={busy || loading}
              value={draft}
              onChange={(e) => {
                dirty.current = true;
                setDraft(e.target.value);
              }}
              maxLength={500000}
              placeholder="先写下来，准备好后再分享。"
            />
          </label>
          <button className="primary" disabled={busy || loading} onClick={() => void save()}>
            {busy ? '保存中…' : '保存草稿'}
          </button>
        </section>
      )}
      {records.items.length > 0 ? (
        <section className="panel">
          <h2>
            {kind === 'draft' ? '已保存的草稿' : kind === 'bookmark' ? '我的收藏' : '最近浏览'}
          </h2>
          {records.items.map((record) => (
            <div className="saved-record" key={record.key}>
              {kind === 'draft' ? (
                <button
                  onClick={() => {
                    setRecordKey(record.key);
                    setDraft(record.value);
                    dirty.current = false;
                    setStatus('已打开保存的草稿');
                  }}
                >
                  {record.value.slice(0, 100) || '空白草稿'}
                </button>
              ) : (
                <RecordPreview value={record.value} />
              )}
              <small>{new Date(record.updatedAt).toLocaleString('zh-CN')}</small>
              {kind === 'bookmark' && (
                <button type="button" className="quiet" disabled={busy || loading} onClick={() => void removeBookmark(record.key)}>
                  取消收藏
                </button>
              )}
            </div>
          ))}
          {records.nextCursor && (
            <button
              className="quiet"
              onClick={() =>
                void load(kind, records.nextCursor || undefined).catch(() =>
                  setError('未能读取更多记录'),
                )
              }
            >
              加载更多
            </button>
          )}
        </section>
      ) : (
        !error &&
        !status && (
          <p className="muted">
            这里还没有{kind === 'draft' ? '保存的草稿' : kind === 'bookmark' ? '收藏' : '浏览记录'}
            。
          </p>
        )
      )}
    </div>
  );
}
