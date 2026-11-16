'use client';
import { useRef, useState } from 'react';
import { useCommunity } from './store';
import { Icon } from './Icon';
import { AccountCenter } from './Account';
import { ThemeSelector } from './Theme';
import { GovernanceCenter, ReportButton } from './Governance';
import { FeedCard } from './Posts';
import {
  age,
  defaultNotifications,
  defaultPrivacy,
  emptyProfile,
  inboxHref,
  readImage,
  replyHref,
  type Profile as ProfileData,
} from './model';

import { prepareAccountChange, finishAccountChange, cancelAccountChange } from '../../lib/browser-session';
export async function logout() {
  await prepareAccountChange();
  try {
  const response = await fetch('/api/session/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error('退出失败，请重试');
  finishAccountChange();
  } catch (error) { cancelAccountChange(); throw error; }
}
export function Profile({ id }: { id?: string }) {
  const { data, compose } = useCommunity();
  const [tab, setTab] = useState('posts');
  const contact = id
    ? data!.contacts.find((contact) => contact.id === id || contact.name === id)
    : undefined;
  const own =
    !id ||
    Boolean(
      data!.actor?.userId && (id === data!.actor.userId || contact?.id === data!.actor.userId),
    );
  const userId = own ? data!.actor?.userId : contact?.id;
  const moderation = data?.actor?.moderation;
  const manageableBoard = moderation?.boards.find(entry => entry.permissions?.includes('users.manage') || entry.role === 'admin')?.board;
  const manageLink = !own && userId && manageableBoard ? <a className="forum-wiki-link" href={(moderation?.admin ? '/admin' : '/moderation') + '?view=users&board=' + encodeURIComponent(manageableBoard) + '&record=' + encodeURIComponent(userId) + '&fromUser=' + encodeURIComponent(userId)}>管理用户</a> : null;
  const visibility = data!.profiles.find((profile) => profile.id === userId);
  const profile = own
    ? data!.userState.profile || { ...emptyProfile, name: data!.actor?.nickname || '同学' }
    : visibility?.profile || { ...emptyProfile, name: contact?.name || '' };
  const posts = data!.content.posts.filter((post) => post.authorId === userId);
  const replies = data!.content.posts.flatMap((post) =>
    (data!.content.comments[post.id] || [])
      .filter((reply) => reply.authorId === userId)
      .map((reply) => ({ post, reply })),
  );
  const marks = data!.content.posts.filter((post) =>
    (own ? data!.userState.bookmarks : visibility?.bookmarks)?.includes(post.id),
  );
  const likes =
    posts.reduce(
      (sum, post) => sum + post.likes + Number(data!.userState.likes.includes(post.id)),
      0,
    ) +
    replies.reduce(
      (sum, { post, reply }) =>
        sum + reply.likes + Number(data!.userState.commentLikes.includes(post.id + ':' + reply.id)),
      0,
    );
  if (!own && visibility?.public === false)
    return <div className="empty">这位同学已隐藏个人主页{manageLink}</div>;
  if (!own && !contact)
    return (
      <div className="empty">
        没有找到这位同学。<a href="#/">返回首页</a>
      </div>
    );
  const tabs = [
    ['posts', '帖子'],
    ['replies', '回复'],
    ...(own || visibility?.bookmarks ? [['marks', '收藏']] : []),
    ...(own ? [['likes', '赞过']] : []),
  ];
  const list =
    tab === 'marks'
      ? marks
      : tab === 'likes'
        ? data!.content.posts.filter((post) => data!.userState.likes.includes(post.id))
        : posts;
  return (
    <>
      {!own && (
        <a className="back" href="#/">
          ← 返回首页
        </a>
      )}
      <section
        className={'me-card profile-card ' + (!own ? 'public-profile' : '')}
        aria-labelledby="profile-name"
      >
        <header className="profile-header">
          {own ? (
            <ProfileAvatar profile={profile} />
          ) : (
            <div className="big-avatar">
              {profile.avatar ? <img src={profile.avatar} alt="" /> : Array.from(profile.name)[0]}
            </div>
          )}
          <div className="profile-identity">
            <div className="profile-name-row">
              <h1 id="profile-name">{profile.name}</h1>
              {own && (
                <span className="profile-verified">
                  <Icon name="check" /> 已登录
                </span>
              )}
            </div>
          </div>
          {own ? (
            <div className="profile-actions">
              <a href="#/settings">设置</a>
            </div>
          ) : (
            <div className="profile-actions">
              <a href={inboxHref(userId)}>私信</a>
              {userId && <><ReportButton target={'profile:' + userId} label="举报资料" /><ReportButton target={'account:' + userId} label="举报账号" /></>}
            </div>
          )}
        </header>
        <div className="profile-details">
          {own ? (
            <ProfileBio key={userId} profile={profile} />
          ) : (
            <p className={'profile-bio ' + (!profile.bio ? 'muted' : '')}>
              {profile.bio || '还没有填写个性签名'}
            </p>
          )}
        </div>
        {manageLink}
        <dl className="profile-stats">
          <div>
            <dt>发帖</dt>
            <dd>{posts.length}</dd>
          </div>
          <div>
            <dt>回复</dt>
            <dd>{replies.length}</dd>
          </div>
          <div>
            <dt>收到赞</dt>
            <dd>{likes}</dd>
          </div>
          {own && (
            <div>
              <dt>收藏</dt>
              <dd>{marks.length}</dd>
            </div>
          )}
        </dl>
      </section>
      <div className="tabs profile-tabs" role="group" aria-label="个人动态">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            className={tab === value ? 'on' : ''}
            data-t={value}
            data-user-tab={value}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
            {value === 'likes' && <span className="vis-note">仅自己可见</span>}
          </button>
        ))}
      </div>
      {tab === 'replies' ? (
        replies.length ? (
          replies.map(({ post, reply }) => (
            <article className="panel" key={reply.id}>
              <a className="user-reply-topic" href={replyHref(post, reply)}>
                {post.title}
              </a>
              <p>{reply.body || (reply.image ? '图片回复' : '')}</p>
              <small className="muted">{age(reply)}</small>
            </article>
          ))
        ) : (
          <div className="empty">还没有回复</div>
        )
      ) : list.length ? (
        <>
          {list.map((post) => (
            <FeedCard key={post.id} post={post} />
          ))}
          {tab === 'likes' && (
            <p className="muted" style={{ textAlign: 'center' }}>
              赞过的内容仅自己可见
            </p>
          )}
        </>
      ) : (
        <div className="empty">
          <p>
            {tab === 'posts'
              ? '还没有发布帖子'
              : tab === 'marks'
                ? '还没有收藏的内容。可以在帖子里点击收藏。'
                : '还没有赞过的内容'}
          </p>
          {own && tab === 'posts' && (
            <button className="btn-primary" onClick={() => compose()}>
              发布第一条
            </button>
          )}
        </div>
      )}
    </>
  );
}
function ProfileAvatar({ profile }: { profile: ProfileData }) {
  const { busy, mutate, toast } = useCommunity();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  return (
    <>
      <button
        type="button"
        className="big-avatar profile-avatar-button"
        aria-label="更换头像"
        title="更换头像，支持 1MB 内 JPG、PNG、GIF、WebP"
        disabled={busy || uploading}
        onClick={() => input.current?.click()}
      >
        {profile.avatar ? <img src={profile.avatar} alt="" /> : Array.from(profile.name)[0]}
        <span className="profile-avatar-hint">{uploading ? '上传中' : '更换头像'}</span>
      </button>
      <input
        ref={input}
        type="file"
        id="avatar-file"
        aria-label="选择新头像"
        hidden
        accept="image/png,image/jpeg,image/gif,image/webp"
        disabled={busy || uploading}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file || uploading || busy) return;
          setUploading(true);
          try {
            const avatar = await readImage(file);
            await mutate(
              (snapshot) => [
                {
                  type: 'profile.save',
                  profile: {
                    ...(snapshot.userState.profile || profile),
                    avatar,
                  },
                },
              ],
              '头像已更新',
            );
          } catch (failure) {
            toast(failure instanceof Error ? failure.message : '头像读取失败');
          } finally {
            setUploading(false);
          }
        }}
      />
    </>
  );
}
function ProfileBio({ profile }: { profile: ProfileData }) {
  const { busy, mutate } = useCommunity();
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  function close() {
    setEditing(false);
    window.setTimeout(() => trigger.current?.focus(), 0);
  }
  if (!editing)
    return (
      <button
        ref={trigger}
        type="button"
        className={'profile-bio profile-bio-button ' + (!profile.bio ? 'muted' : '')}
        aria-label="编辑个性签名"
        title="点击修改个性签名"
        disabled={busy}
        onClick={() => {
          setBio(profile.bio);
          setEditing(true);
        }}
      >
        <span>{profile.bio || '写一句个性签名，让大家认识你。'}</span>
        <span className="profile-bio-edit-hint">编辑</span>
      </button>
    );
  return (
    <form
      className="profile-bio-inline"
      aria-label="修改个性签名"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || saving) return;
        setSaving(true);
        try {
          const saved = await mutate(
            (snapshot) => [
              {
                type: 'profile.save',
                profile: {
                  ...(snapshot.userState.profile || profile),
                  bio: bio.trim(),
                },
              },
            ],
            '个性签名已更新',
          );
          if (saved) close();
        } finally {
          setSaving(false);
        }
      }}
    >
      <textarea
        id="pf-bio"
        aria-label="个性签名"
        autoFocus
        maxLength={60}
        rows={2}
        value={bio}
        placeholder="写一句个性签名，让大家认识你。"
        disabled={busy || saving}
        onChange={(event) => setBio(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !saving && !event.nativeEvent.isComposing) {
            event.preventDefault();
            close();
          }
        }}
      />
      <div className="profile-bio-inline-actions">
        <span className="muted">{bio.length} / 60</span>
        <button className="link-btn" type="button" disabled={saving} onClick={close}>
          取消
        </button>
        <button className="btn-primary" id="pf-save" type="submit" disabled={busy || saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}
export function Settings({ initialTab = 'account' }: { initialTab?: string } = {}) {
  const { data, busy, mutate, toast } = useCommunity();
  const tab = ['account', 'notify', 'privacy', 'general', 'governance'].includes(initialTab) ? initialTab : 'account';
  const notifications = { ...defaultNotifications, ...data!.userState.notifPrefs };
  const privacy = { ...defaultPrivacy, ...data!.userState.privacyPrefs };
  const notifyRows = [
    ['reply', '回复我的', '有人回复我的帖子或评论'],
    ['like', '赞与收藏', '我收到的赞和收藏'],
    ['follow', '关注更新', '关注的标签有新帖，或关注的帖子有新回复'],
    ['system', '校园公告', '在通知中心接收当前校园公告'],
  ] as const;
  const privacyRows = [
    ['profilePublic', '个人主页公开', '关闭后隐藏个人主页'],
    ['marksPublic', '收藏公开', '关闭后收藏列表仅自己可见'],
  ] as const;
  return (
    <>
      <a className="back" href="#/me">
        ← 返回个人主页
      </a>
      <div className="page-head">
        <h1>设置</h1>
      </div>
      <nav className="set-nav" aria-label="设置分类">
        {[
          ['account', '账号与安全'],
          ['notify', '通知偏好'],
          ['privacy', '隐私'],
          ['general', '通用'],
          ['governance', '举报与申诉'],
        ].map(([value, label]) => (
          <a
            href={'#/settings/' + value}
            key={value}
            data-st={value}
            className={tab === value ? 'on' : ''}
            aria-current={tab === value ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <div id="set-panel">
        {tab === 'account' ? (
          <AccountCenter />
        ) : tab === 'governance' ? <GovernanceCenter /> : tab === 'notify' ? (
          <div className="set-sec">
            <h2>通知偏好</h2>
            {notifyRows.map(([key, label, detail]) => (
              <div className="set-row" key={key}>
                <div className="k">
                  {label}
                  <small>{detail}</small>
                </div>
                <div className="v">
                  <button
                    className={'switch ' + (notifications[key] ? 'on' : '')}
                    data-sw={'n:' + key}
                    aria-label={label}
                    role="switch"
                    aria-checked={notifications[key]}
                    disabled={busy}
                    onClick={() =>
                      void mutate([
                        {
                          type: 'state.save',
                          state: { notifPrefs: { ...notifications, [key]: !notifications[key] } },
                        },
                      ])
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        ) : tab === 'privacy' ? (
          <div className="set-sec">
            <h2>隐私</h2>
            {privacyRows.map(([key, label, detail]) => (
              <div className="set-row" key={key}>
                <div className="k">
                  {label}
                  <small>{detail}</small>
                </div>
                <div className="v">
                  <button
                    className={'switch ' + (privacy[key] ? 'on' : '')}
                    data-sw={'p:' + key}
                    aria-label={label}
                    role="switch"
                    aria-checked={privacy[key]}
                    disabled={busy}
                    onClick={() =>
                      void mutate([
                        {
                          type: 'state.save',
                          state: { privacyPrefs: { ...privacy, [key]: !privacy[key] } },
                        },
                      ])
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="set-sec">
            <h2>显示设置</h2>
            <div className="set-row">
              <div className="k">主题</div>
              <ThemeSelector />
            </div>
            <div className="set-row">
              <div className="k">语言</div>
              <div className="v">简体中文</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
