'use client';
import { useState } from 'react';
import type { PollView } from '../../../../../packages/contracts/src/interest';
import { useCommunity } from '../community/store';
import { interestApi, useInterest } from './api';

export function PostPoll({ postId, own }: { postId: string; own: boolean }) {
  const { requireLogin, toast } = useCommunity(),
    result = useInterest<{ poll: PollView | null }>('polls/' + postId);
  const [editing, setEditing] = useState(false),
    [question, setQuestion] = useState(''),
    [options, setOptions] = useState(''),
    [end, setEnd] = useState(() => {
      const tomorrow = new Date(Date.now() + 86400000);
      return new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    }),
    [busy, setBusy] = useState(false);
  const poll = result.data?.poll;
  async function vote(option: number) {
    if (!requireLogin()) return;
    setBusy(true);
    try {
      await interestApi(`polls/${postId}/vote`, { option, version: poll!.version });
      result.refresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (result.loading)
    return (
      <p className="muted" role="status">
        正在加载投票…
      </p>
    );
  if (result.error)
    return (
      <p role="alert">
        投票暂不可用{' '}
        <button className="link-btn" onClick={result.refresh}>
          重试
        </button>
      </p>
    );
  return (
    <section className="interest-poll" aria-label="帖子投票">
      {poll && (
        <>
          <h2>{poll.question}</h2>
          <p className="muted">
            单选 · {poll.total} 票 ·{' '}
            {poll.state === 'open'
              ? '截止 ' + new Date(poll.endsAt).toLocaleString()
              : poll.state === 'cancelled'
                ? '已撤销'
                : '已结束'}{' '}
            · 仅公开汇总
          </p>
          <div className="interest-poll-options">
            {poll.options.map((option, i) => (
              <button
                key={i}
                disabled={busy || poll.state !== 'open'}
                aria-pressed={poll.myVote === i}
                onClick={() => void vote(i)}
              >
                <span>
                  {option.text}
                  {poll.myVote === i ? ' ✓' : ''}
                </span>
                <span>
                  {option.count} 票
                  {poll.total ? ' · ' + Math.round((option.count / poll.total) * 100) + '%' : ''}
                </span>
              </button>
            ))}
          </div>
          {own && poll.state === 'open' && (
            <div className="interest-actions">
              {poll.canEdit && (
                <button
                  className="link-btn"
                  onClick={() => {
                    setQuestion(poll.question);
                    setOptions(poll.options.map((o) => o.text).join('\n'));
                    setEnd(
                      new Date(
                        new Date(poll.endsAt).getTime() -
                          new Date(poll.endsAt).getTimezoneOffset() * 60000,
                      )
                        .toISOString()
                        .slice(0, 16),
                    );
                    setEditing(true);
                  }}
                >
                  编辑投票
                </button>
              )}
              <button
                className="link-btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await interestApi(`polls/${postId}/cancel`, {});
                    result.refresh();
                  } catch (e) {
                    toast((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                撤销投票并保留结果
              </button>
            </div>
          )}
        </>
      )}
      {!poll && own && !editing && (
        <button className="btn-ghost" onClick={() => setEditing(true)}>
          为这个帖子添加投票
        </button>
      )}
      {editing && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!requireLogin()) return;
            setBusy(true);
            try {
              await interestApi(
                poll ? 'polls/' + postId : 'polls',
                {
                  postId,
                  question,
                  options: options
                    .split('\n')
                    .map((o) => o.trim())
                    .filter(Boolean),
                  endsAt: new Date(end).toISOString(),
                },
                poll ? 'PUT' : 'POST',
              );
              setEditing(false);
              result.refresh();
            } catch (error) {
              toast((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>{poll ? '编辑投票' : '添加单选投票'}</h2>
          <label>
            投票问题
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              minLength={2}
              maxLength={200}
              required
            />
          </label>
          <label>
            选项，每行一个（2–8 个）
            <textarea
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              required
              maxLength={808}
            />
          </label>
          <label>
            截止时间
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
          </label>
          <p className="muted">每个账号保留一票，截止前可改选。有人投票后问题与选项冻结。</p>
          <div className="interest-actions">
            <button className="btn-primary" disabled={busy}>
              保存投票
            </button>
            <button className="link-btn" type="button" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
