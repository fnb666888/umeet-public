'use client';
import { useRef, useState } from 'react';
import { adminRequest } from '../admin/admin-api';
import { useCommunity } from './store';
import type { Post } from './model';

export function PostModeration({ post }: { post: Post }) {
  const { data, refresh, toast } = useCommunity();
  const [action, setAction] = useState('pin');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const grant = data?.actor?.moderation?.boards.find((item) => item.board === post.community);
  if (!grant || (grant.permissions && !grant.permissions.includes('content'))) return null;
  return (
    <details className="post-moderation">
      <summary>管理帖子</summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          const payload =
            action === 'hide'
              ? {
                  action: 'visibility',
                  target: 'post:' + post.id,
                  hidden: true,
                  reason: reason.trim(),
                }
              : {
                  action: 'post.settings',
                  target: 'post:' + post.id,
                  reason: reason.trim(),
                  ...(action === 'pin' ? { pinned: !post.pinned } : { locked: !post.locked }),
                };
          const fingerprint = JSON.stringify({ ...payload, board: post.community });
          if (pending.current?.fingerprint !== fingerprint)
            pending.current = { fingerprint, id: crypto.randomUUID() };
          try {
            await adminRequest('actions?board=' + post.community, {
              ...payload,
              id: pending.current.id,
            });
            await refresh();
            setReason('');
            pending.current = null;
            toast('管理操作已完成');
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          操作
          <select
            value={action}
            onChange={(event) => setAction(event.target.value)}
            disabled={busy}
          >
            <option value="pin">{post.pinned ? '取消置顶' : '置顶帖子'}</option>
            <option value="lock">{post.locked ? '解锁回复' : '锁定回复'}</option>
            <option value="hide">删除帖子</option>
          </select>
        </label>
        <label>
          处理原因
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            minLength={2}
            maxLength={500}
            disabled={busy}
          />
        </label>
        <button className="btn-primary" disabled={busy}>
          {busy ? '正在处理…' : '确认操作'}
        </button>
        <a href={(data?.actor?.moderation?.admin ? '/admin' : '/moderation') + '?board=' + post.community}>
          {data?.actor?.moderation?.admin ? '进入全站后台' : '进入社区工作台'}
        </a>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
