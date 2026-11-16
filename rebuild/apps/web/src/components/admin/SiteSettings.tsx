'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  SiteSettings as Settings,
  SiteSettingsSnapshot,
} from '../../../../../packages/contracts/src/site-settings';
import { boards } from '../community/model';
import { ApplicationPolicy } from './ApplicationPolicy';
import { adminRequest, cachedAdminRead } from './admin-api';
import { useUnsavedSettings } from './use-unsaved-settings';

const tabs = [
  ['site', '站点信息'],
  ['announcements', '公告'],
  ['boards', '板块规则'],
  ['reportReasons', '举报理由'],
  ['registration', '注册与通知'],
] as const;
type Board = string;
type Announcement = Settings['announcements'][number];
type Reason = Settings['reportReasons'][number];

function localDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function BoardScope({ value, onChange }: { value: Board[]; onChange: (value: Board[]) => void }) {
  return (
    <fieldset className="settings-scope">
      <legend>适用板块</legend>
      <p className="admin-help">{value.length ? '仅在所选板块生效' : '当前适用于全站'}</p>
      <div>
        {boards.map(({ slug, name }) => (
          <label key={slug}>
            <input
              type="checkbox"
              checked={value.includes(slug)}
              onChange={(event) =>
                onChange(
                  event.target.checked ? [...value, slug] : value.filter((item) => item !== slug),
                )
              }
            />{' '}
            {name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SiteSettings({ revision: refresh }: { revision: number }) {
  const [saved, setSaved] = useState<SiteSettingsSnapshot | null>(() => cachedAdminRead<SiteSettingsSnapshot>('site-settings') ?? null);
  const [draft, setDraft] = useState<Settings | null>(() => cachedAdminRead<SiteSettingsSnapshot>('site-settings')?.settings ?? null);
  const [tab, setTab] = useState<(typeof tabs)[number][0]>('site');
  const [board, setBoard] = useState<Board>('daily');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState('');
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const anyDirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved.settings);
  const dirtyRef = useRef(anyDirty); dirtyRef.current = anyDirty;
  useUnsavedSettings(anyDirty, busy);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void adminRequest<SiteSettingsSnapshot>('site-settings', undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          if (dirtyRef.current) return;
          setSaved(value);
          setDraft(value.settings);
          setNotice('');
        }
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) { setSaved(null); setDraft(null); setError(failure.message); }
      });
    return () => controller.abort();
  }, [refresh, reload]);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((current) => current && { ...current, [key]: value });
    setNotice('');
  }

  if (!draft || !saved)
    return error ? (
      <div className="admin-feedback admin-error" role="alert">
        {error}{' '}
        <button type="button" onClick={() => setReload((value) => value + 1)}>
          重试
        </button>
      </div>
    ) : (
      <p className="admin-empty" role="status">
        正在加载站点设置…
      </p>
    );
  const pageDraft =
    tab === 'registration'
      ? { registration: draft.registration, notifications: draft.notifications }
      : { [tab]: draft[tab] };
  const dirty = Object.entries(pageDraft).some(
    ([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(saved.settings[key as keyof Settings]),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !saved || busy || !dirty) return;
    setBusy(true);
    setError('');
    try {
      const normalized = {
        ...saved.settings,
        ...pageDraft,
        boards: { ...(tab === 'boards' ? draft.boards : saved.settings.boards) },
      };
      for (const { slug } of tab === 'boards' ? boards : []) {
        const rule = normalized.boards[slug];
        normalized.boards[slug] = {
          ...rule,
          rules: rule.rules.map((line) => line.trim()).filter(Boolean),
        };
      }
      const value = await adminRequest<SiteSettingsSnapshot>('site-settings', {
        revision: saved.revision,
        settings: {
          ...normalized,
          registration:
            tab !== 'registration'
              ? normalized.registration
              : {
                  ...normalized.registration,
                  domains: [
                    ...new Set(
                      normalized.registration.domains
                        .map((domain) => domain.trim().toLowerCase())
                        .filter(Boolean),
                    ),
                  ],
                },
        },
      });
      setSaved(value);
      setDraft({
        ...draft,
        ...(tab === 'registration'
          ? {
              registration: value.settings.registration,
              notifications: value.settings.notifications,
            }
          : { [tab]: value.settings[tab] }),
      });
      setNotice('当前设置页已保存。');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updatePosting(changes: Partial<Settings['boards'][Board]['posting']>) {
    if (!draft) return;
    update('boards', {
      ...draft.boards,
      [board]: {
        ...draft.boards[board],
        posting: { ...draft.boards[board].posting, ...changes },
      },
    });
  }

  async function generateInvite() {
    setBusy(true);
    setError('');
    try {
      setInvite(await adminRequest<{ code: string; expiresAt: string }>('registration-invite', {}));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateAnnouncement(id: string, changes: Partial<Announcement>) {
    update(
      'announcements',
      draft!.announcements.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }

  function updateReason(id: string, changes: Partial<Reason>) {
    update(
      'reportReasons',
      draft!.reportReasons.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }

  function moveReason(index: number, direction: -1 | 1) {
    const items = [...draft!.reportReasons];
    const next = index + direction;
    [items[index], items[next]] = [items[next]!, items[index]!];
    update('reportReasons', items);
  }

  return (
    <div className="site-settings" data-account-draft-safe>
      <nav className="admin-tabs" aria-label="站点设置分类">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            aria-current={tab === value ? 'page' : undefined}
            disabled={busy}
            onClick={() => {
              setTab(value);
              setNotice('');
              setError('');
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'registration' && <ApplicationPolicy />}
      <form onSubmit={submit}>
        <fieldset className="settings-fields" disabled={busy}>
          {tab === 'site' && (
            <>
              <section className="settings-panel">
                <h2>站点信息</h2>
                <label>
                  站点名称
                  <input
                    required
                    maxLength={40}
                    value={draft.site.title}
                    onChange={(event) =>
                      update('site', { ...draft.site, title: event.target.value })
                    }
                  />
                </label>
                <label>
                  首页简介
                  <textarea
                    rows={2}
                    maxLength={240}
                    value={draft.site.description}
                    onChange={(event) =>
                      update('site', { ...draft.site, description: event.target.value })
                    }
                  />
                </label>
                <div className="settings-columns">
                  <label>
                    Logo 地址
                    <input
                      type="url"
                      placeholder="https://"
                      maxLength={500}
                      value={draft.site.logo}
                      onChange={(event) =>
                        update('site', { ...draft.site, logo: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    反馈页面地址
                    <input
                      type="url"
                      placeholder="https://"
                      maxLength={500}
                      value={draft.site.feedback}
                      onChange={(event) =>
                        update('site', { ...draft.site, feedback: event.target.value })
                      }
                    />
                  </label>
                </div>
              </section>
            </>
          )}
          {tab === 'announcements' && (
            <>
              <section className="settings-panel">
                <div className="settings-heading">
                  <h2>社区公告</h2>
                  <button
                    type="button"
                    disabled={draft.announcements.length >= 8}
                    onClick={() => {
                      const id = crypto.randomUUID();
                      setExpanded(id);
                      update('announcements', [
                        ...draft.announcements,
                        {
                          id,
                          title: '',
                          body: '',
                          boards: [],
                          enabled: false,
                          startsAt: null,
                          endsAt: null,
                        },
                      ]);
                    }}
                  >
                    添加公告
                  </button>
                </div>
                <p className="admin-help">
                  全站公告显示在首页。板块公告显示在所选板块。时间使用当前设备时区。
                </p>
                {!draft.announcements.length && <p className="admin-help">暂无公告</p>}
                {draft.announcements.map((item) => (
                  <details
                    className="settings-item"
                    key={item.id}
                    open={expanded === item.id ? true : undefined}
                  >
                    <summary>
                      {item.title || '新公告'} <span>{item.enabled ? '已启用' : '已停用'}</span>
                    </summary>
                    <label>
                      公告标题
                      <input
                        required
                        maxLength={80}
                        value={item.title}
                        onChange={(event) =>
                          updateAnnouncement(item.id, { title: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      公告内容
                      <textarea
                        rows={3}
                        required
                        maxLength={500}
                        value={item.body}
                        onChange={(event) =>
                          updateAnnouncement(item.id, { body: event.target.value })
                        }
                      />
                    </label>
                    <BoardScope
                      value={item.boards}
                      onChange={(value) => updateAnnouncement(item.id, { boards: value })}
                    />
                    <div className="settings-columns">
                      <label>
                        开始展示
                        <input
                          type="datetime-local"
                          value={localDate(item.startsAt)}
                          onChange={(event) =>
                            updateAnnouncement(item.id, {
                              startsAt: event.target.value
                                ? new Date(event.target.value).toISOString()
                                : null,
                            })
                          }
                        />
                      </label>
                      <label>
                        结束展示
                        <input
                          type="datetime-local"
                          value={localDate(item.endsAt)}
                          onChange={(event) =>
                            updateAnnouncement(item.id, {
                              endsAt: event.target.value
                                ? new Date(event.target.value).toISOString()
                                : null,
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="settings-heading">
                      <label className="settings-checkbox">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(event) =>
                            updateAnnouncement(item.id, { enabled: event.target.checked })
                          }
                        />{' '}
                        启用公告
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          update(
                            'announcements',
                            draft.announcements.filter((entry) => entry.id !== item.id),
                          )
                        }
                      >
                        移除公告
                      </button>
                    </div>
                  </details>
                ))}
              </section>
            </>
          )}
          {tab === 'boards' && (
            <section className="settings-panel">
              <h2>板块规则</h2>
              <label>
                选择板块
                <select value={board} onChange={(event) => setBoard(event.target.value as Board)}>
                  {boards.map(({ slug, name }) => (
                    <option key={slug} value={slug}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                板块简介
                <input
                  required
                  maxLength={160}
                  value={draft.boards[board].description}
                  onChange={(event) =>
                    update('boards', {
                      ...draft.boards,
                      [board]: { ...draft.boards[board], description: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                板块规则 <small>每行一条，最多六条。</small>
                <textarea
                  rows={6}
                  value={draft.boards[board].rules.join('\n')}
                  onChange={(event) =>
                    update('boards', {
                      ...draft.boards,
                      [board]: { ...draft.boards[board], rules: event.target.value.split('\n') },
                    })
                  }
                />
              </label>
              <label>
                发帖提示
                <textarea
                  rows={3}
                  maxLength={240}
                  value={draft.boards[board].prompt}
                  onChange={(event) =>
                    update('boards', {
                      ...draft.boards,
                      [board]: { ...draft.boards[board], prompt: event.target.value },
                    })
                  }
                />
              </label>
              <h2>发帖限制</h2>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={draft.boards[board].posting.readonly}
                  onChange={(event) => updatePosting({ readonly: event.target.checked })}
                />{' '}
                只读，暂停新增帖子和回复
              </label>
              <label>
                发帖和回复间隔（秒）
                <small>0 表示不限。同一账号在本板块的发帖和回复共用此间隔。</small>
                <input
                  type="number"
                  min={0}
                  max={3600}
                  required
                  value={draft.boards[board].posting.cooldownSeconds}
                  onChange={(event) =>
                    updatePosting({ cooldownSeconds: Number(event.target.value) })
                  }
                />
              </label>
            </section>
          )}
          {tab === 'registration' && (
            <section className="settings-panel">
              <h2>注册准入</h2>
              <label>
                注册方式
                <select
                  value={draft.registration.mode}
                  onChange={(event) =>
                    update('registration', {
                      ...draft.registration,
                      mode: event.target.value as Settings['registration']['mode'],
                    })
                  }
                >
                  <option value="open">开放注册</option>
                  <option value="invite">仅限邀请</option>
                  <option value="campus">仅限校园邮箱</option>
                </select>
              </label>
              {draft.registration.mode === 'campus' && (
                <label>
                  允许的邮箱域名 <small>每行一个完整域名，例如 example.edu.cn。</small>
                  <textarea
                    rows={4}
                    value={draft.registration.domains.join('\n')}
                    onChange={(event) =>
                      update('registration', {
                        ...draft.registration,
                        domains: event.target.value.split('\n'),
                      })
                    }
                  />
                </label>
              )}
              {draft.registration.mode === 'invite' && (
                <>
                  <p className="admin-help">
                    邀请码有效期为 7 天，只能注册一个账号。生成后请复制并交给受邀人。
                  </p>
                  <button
                    type="button"
                    disabled={saved.settings.registration.mode !== 'invite'}
                    onClick={() => void generateInvite()}
                  >
                    生成邀请码
                  </button>
                  {invite && (
                    <label>
                      本次生成的邀请码
                      <input
                        readOnly
                        value={invite.code}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <small>到期时间 {new Date(invite.expiresAt).toLocaleString('zh-CN')}</small>
                    </label>
                  )}
                </>
              )}
              <h2>新用户通知</h2>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={draft.notifications.announcements}
                  onChange={(event) =>
                    update('notifications', { announcements: event.target.checked })
                  }
                />{' '}
                新账号默认接收校园公告
              </label>
              <p className="admin-help">用户可以在个人设置中调整此偏好。</p>
            </section>
          )}
          {tab === 'reportReasons' && (
            <section className="settings-panel">
              <div className="settings-heading">
                <h2>举报理由</h2>
                <button
                  type="button"
                  disabled={draft.reportReasons.length >= 30}
                  onClick={() => {
                    const id = 'custom-' + crypto.randomUUID();
                    setExpanded(id);
                    update('reportReasons', [
                      ...draft.reportReasons,
                      { id, label: '', enabled: true, boards: [] },
                    ]);
                  }}
                >
                  添加理由
                </button>
              </div>
              <p className="admin-help">
                顺序与举报表单一致。停用只影响新举报，历史记录保留提交时的理由。
              </p>
              {draft.reportReasons.map((reason, index) => (
                <details
                  className="settings-item"
                  key={reason.id}
                  open={expanded === reason.id ? true : undefined}
                >
                  <summary>
                    {reason.label || '新举报理由'}{' '}
                    <span>{reason.enabled ? '已启用' : '已停用'}</span>
                  </summary>
                  <label>
                    显示名称
                    <input
                      required
                      maxLength={40}
                      value={reason.label}
                      onChange={(event) => updateReason(reason.id, { label: event.target.value })}
                    />
                  </label>
                  {reason.id === 'other' ? (
                    <p className="admin-help">此理由始终适用于全站，方便提交其他问题。</p>
                  ) : (
                    <>
                      <BoardScope
                        value={reason.boards}
                        onChange={(value) => updateReason(reason.id, { boards: value })}
                      />
                      <label className="settings-checkbox">
                        <input
                          type="checkbox"
                          checked={reason.enabled}
                          onChange={(event) =>
                            updateReason(reason.id, { enabled: event.target.checked })
                          }
                        />{' '}
                        启用理由
                      </label>
                    </>
                  )}
                  <div className="settings-sort">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveReason(index, -1)}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      disabled={index === draft.reportReasons.length - 1}
                      onClick={() => moveReason(index, 1)}
                    >
                      下移
                    </button>
                    {reason.id.startsWith('custom-') && (
                      <button
                        type="button"
                        onClick={() =>
                          update(
                            'reportReasons',
                            draft.reportReasons.filter((item) => item.id !== reason.id),
                          )
                        }
                      >
                        移除理由
                      </button>
                    )}
                  </div>
                </details>
              ))}
            </section>
          )}
        </fieldset>
        {error && (
          <div role="alert" className="admin-feedback admin-error">
            {error}
            <button type="button" disabled={busy} onClick={() => setReload((value) => value + 1)}>
              重新加载设置
            </button>
          </div>
        )}
        {notice && (
          <p className="admin-feedback" role="status">
            {notice}
          </p>
        )}
        <footer className="settings-save">
          <span role="status">{dirty ? '当前页有未保存的更改' : anyDirty ? '其他页签有未保存的更改' : '所有更改已保存'}</span>
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() => {
              setDraft({
                ...draft,
                ...(tab === 'registration'
                  ? {
                      registration: saved.settings.registration,
                      notifications: saved.settings.notifications,
                    }
                  : { [tab]: saved.settings[tab] }),
              });
              setError('');
            }}
          >
            撤销修改
          </button>
          <button className="admin-primary" disabled={!dirty || busy}>
            {busy ? '正在保存…' : '保存更改'}
          </button>
        </footer>
      </form>
    </div>
  );
}
