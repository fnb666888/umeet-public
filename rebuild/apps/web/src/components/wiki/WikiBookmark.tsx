'use client';
import { useState } from 'react';
export function WikiBookmark({ pageId, title, post = false }: { pageId: string; title: string; post?: boolean }) {
  const [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const response = await fetch('/api/backend/records/bookmark/' + (post ? 'post-' : 'wiki-') + pageId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify({ title, href: (post ? '/posts/' : '/wiki/') + pageId }) }),
      });
      setStatus(
        response.ok
          ? '已收藏'
          : response.status === 401
            ? '请先登录或选择游客身份'
            : '暂时未能收藏，请重试',
      );
    } catch {
      setStatus('网络连接失败，请重试');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="quiet" disabled={busy} onClick={() => void save()}>
        {busy ? '正在收藏…' : post ? '收藏帖子' : '收藏词条'}
      </button>
      {status && (
        <span role="status" className="muted">
          {status}
        </span>
      )}
    </>
  );
}
