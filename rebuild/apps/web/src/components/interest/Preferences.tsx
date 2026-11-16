'use client';
import { useState } from 'react';
import {
  interestBoards,
  type InterestPreferences,
} from '../../../../../packages/contracts/src/interest';
import { useCommunity } from '../community/store';
import { PostList } from '../community/Posts';
import type { Post } from '../community/model';
import { interestApi, useInterest } from './api';

export function InterestOnboarding({ allowEdit = false }: { allowEdit?: boolean }) {
  const { data, refresh } = useCommunity();
  const state = useInterest<InterestPreferences & { onboardingNeeded: boolean }>(
    data?.actor?.kind === 'member' ? 'preferences' : null,
  );
  const [selected, setSelected] = useState<string[]>([]),
    [tags, setTags] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  if (!state.data) return null;
  if (!state.data.onboardingNeeded && !editing)
    return allowEdit ? (
      <button
        className="link-btn"
        onClick={() => {
          setSelected(state.data!.boards);
          setTags(state.data!.tags.join('，'));
          setEditing(true);
        }}
      >
        调整兴趣
      </button>
    ) : null;
  async function save(skipped: boolean) {
    setBusy(true);
    setError('');
    try {
      await interestApi(
        'preferences',
        {
          onboarding: skipped ? 'skipped' : 'completed',
          boards: skipped ? [] : selected,
          tags: skipped
            ? []
            : tags
                .split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean)
                .slice(0, 30),
        },
        'PUT',
      );
      state.refresh();
      await refresh();
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="interest-onboarding" aria-label="选择兴趣">
      <h2>选择感兴趣的话题</h2>
      <p className="muted">自愿订阅，也可以稍后在发现页选择。现有订阅会保留。</p>
      <div className="interest-choices">
        {interestBoards.map((b) => (
          <label key={b.slug}>
            <input
              type="checkbox"
              checked={selected.includes(b.slug)}
              disabled={busy}
              onChange={() =>
                setSelected((values) =>
                  values.includes(b.slug)
                    ? values.filter((v) => v !== b.slug)
                    : [...values, b.slug],
                )
              }
            />
            {b.name}
          </label>
        ))}
      </div>
      <label>
        兴趣标签
        <input
          value={tags}
          maxLength={300}
          placeholder="可选，用逗号分隔"
          onChange={(e) => setTags(e.target.value)}
          disabled={busy}
        />
      </label>
      <div className="interest-actions">
        <button className="btn-primary" disabled={busy} onClick={() => void save(false)}>
          保存兴趣
        </button>
        <button className="link-btn" disabled={busy} onClick={() => void save(true)}>
          暂时跳过
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function RecommendationList({ posts }: { posts: Post[] }) {
  const { requireLogin, toast } = useCommunity();
  const result = useInterest<{ items: { id: string; reasons: string[] }[] }>('recommendations');
  const [busy, setBusy] = useState('');
  if (result.loading) return <p role="status">正在整理推荐…</p>;
  if (result.error)
    return (
      <p role="alert">
        {result.error}{' '}
        <button className="link-btn" onClick={result.refresh}>
          重试
        </button>
      </p>
    );
  const items =
    result.data?.items.flatMap((item) => {
      const post = posts.find((p) => p.id === item.id);
      return post ? [{ ...item, post }] : [];
    }) || [];
  return (
    <>
      {!items.length && <p className="empty">暂时没有适合的推荐，可以查看最新内容或选择兴趣。</p>}
      {items.map((item) => (
        <section className="interest-recommendation" key={item.id}>
          <div className="interest-reason">
            <span>{item.reasons.join(' · ')}</span>
            <button
              className="link-btn"
              disabled={busy === item.id}
              onClick={async () => {
                if (!requireLogin()) return;
                setBusy(item.id);
                try {
                  await interestApi('dismiss/' + item.id, {});
                  result.refresh();
                } catch (e) {
                  toast((e as Error).message);
                } finally {
                  setBusy('');
                }
              }}
            >
              不感兴趣
            </button>
          </div>
          <PostList posts={[item.post]} />
        </section>
      ))}
    </>
  );
}
