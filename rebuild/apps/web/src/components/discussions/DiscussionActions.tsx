'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Vote } from '../../../../../packages/contracts/src/discussions';

async function write(path: string, body: object, method = 'POST') {
  const response = await fetch('/api/backend/discussions' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 401 || response.status === 403)
    throw new Error('请先登录正式账号，或确认你有权限进行此操作。');
  if (response.status === 404) throw new Error('这条内容当前不可用，请刷新页面。');
  if (!response.ok) throw new Error('操作未完成，请稍后重试。');
  return response.json();
}

export function DiscussionForm({
  community,
  boards,
  postId,
  parentId,
}: {
  community?: string;
  boards?: { slug: string; name: string }[];
  postId?: string;
  parentId?: string;
}) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const post = community !== undefined || boards !== undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = String(data.get('body') ?? '').trim();
    const title = String(data.get('title') ?? '').trim();
    const selected = community ?? String(data.get('board') ?? '');
    if (!body || (post && (!title || !selected))) {
      setMessage('请先填写内容。');
      return;
    }
    setBusy(true);
    setMessage('');
    const id = (requestId.current ??= crypto.randomUUID());
    try {
      if (post) await write('', { id, community: selected, title, body });
      else await write('/' + postId + '/comments', { id, parentId: parentId ?? null, body });
      requestId.current = null;
      form.reset();
      setMessage(post ? '帖子已发布。' : '回复已发布。');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="discussion-form"
      onSubmit={submit}
      onChange={() => {
        requestId.current = null;
      }}
    >
      {boards && <label>板块<select aria-label="板块" name="board" defaultValue={community ?? ''} required disabled={busy}>
        <option value="" disabled>选择发帖板块</option>
        {boards.map(board => <option key={board.slug} value={board.slug}>{board.name}</option>)}
      </select></label>}
      {post && (
        <label>
          标题
          <input name="title" required maxLength={160} disabled={busy} />
        </label>
      )}
      <label>
        {post ? '正文' : '回复内容'}
        <textarea
          name="body"
          rows={post ? 5 : 3}
          required
          maxLength={post ? 10000 : 2000}
          disabled={busy}
        />
      </label>
      <button className="primary" disabled={busy}>
        {busy ? '提交中…' : post ? '提交帖子' : '提交回复'}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}

export function DiscussionVote({
  postId,
  score,
  vote,
}: {
  postId: string;
  score: number;
  vote: Vote;
}) {
  const [current, setCurrent] = useState({ score, value: vote });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function select(value: Vote) {
    setBusy(true);
    setMessage('');
    try {
      setCurrent(
        await write('/' + postId + '/vote', { value: current.value === value ? 0 : value }, 'PUT'),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '投票失败。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="discussion-meta">
      <button
        type="button"
        aria-pressed={current.value === 1}
        disabled={busy}
        onClick={() => void select(1)}
      >
        赞
      </button>
      <span aria-live="polite">得分 {current.score}</span>
      <button
        type="button"
        aria-pressed={current.value === -1}
        disabled={busy}
        onClick={() => void select(-1)}
      >
        踩
      </button>
      {message && <span role="status">{message}</span>}
    </div>
  );
}

export function DiscussionReasonForm({
  path,
  kind,
  report = false,
  published = false,
}: {
  path: string;
  kind?: 'post' | 'comment';
  report?: boolean;
  published?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const control = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const reason = String(new FormData(form).get('reason') ?? '').trim();
    if (!reason) return;
    setBusy(true);
    setMessage('');
    try {
      await write(
        path,
        report ? { reason } : { reason, kind, decision: control?.value ?? 'publish' },
      );
      form.reset();
      setMessage(report ? '举报已提交。' : '处理完成。');
      if (!report) router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作未完成。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="discussion-form" onSubmit={submit}>
      <label>
        {report ? '举报原因' : '处理理由'}
        <input name="reason" required maxLength={500} disabled={busy} />
      </label>
      <div className="discussion-meta">
        {report ? (
          <button disabled={busy}>提交举报</button>
        ) : (
          <>
            <button disabled={busy} value="publish">
              {published ? '保留帖子' : '审核通过'}
            </button>
            <button disabled={busy} value="hide">
              {published ? '下架' : '驳回'}
            </button>
          </>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
