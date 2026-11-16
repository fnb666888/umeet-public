'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, ChevronLeft, Search } from 'lucide-react';
import {
  moderatorGroupId,
  moderationOperations,
  permissionLabels,
  permissionTemplates,
  normalizePermissions,
} from '../../../../../packages/contracts/src/moderation-permissions';
import type {
  AdminItem,
  AdminList,
  ModerationGroup,
  ModerationPermission,
} from '../../../../../packages/contracts/src/admin';
import { boards } from '../community/model';
import { adminRequest, cachedAdminRead } from './admin-api';
import { governanceRequest } from '../community/governance-client';

const categories = [
  ['reports', '举报'],
  ['content', '内容'],
  ['users', '用户'],
  ['appeals', '申诉'],
  ['wiki', 'Wiki'],
  ['history', '记录'],
];
const empty: ModerationGroup = { id: '', name: '', boards: [], permissions: [], members: [] };

export function PermissionGroups({
  revision,
  owner = false,
  onAccessChange,
}: {
  revision: number;
  owner?: boolean;
  onAccessChange?: () => void;
}) {
  const [groups, setGroups] = useState<ModerationGroup[]>(() => cachedAdminRead<ModerationGroup[]>('groups') ?? []);
  const [editing, setEditing] = useState<ModerationGroup | null>(null);
  const [tab, setTab] = useState('members');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberFilter, setMemberFilter] = useState('');
  const [candidates, setCandidates] = useState<AdminItem[]>([]);
  const [selected, setSelected] = useState<AdminItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [assignedBoards, setAssignedBoards] = useState<ModerationGroup['boards']>([]);
  const [assignmentUser, setAssignmentUser] = useState<{ id: string; nickname: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(() => !cachedAdminRead('groups'));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'add' | 'transfer' | 'boards' | null>(null);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    run: () => Promise<void>;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const searchSequence = useRef(0);

  async function refresh(id?: string) {
    const value = await adminRequest<ModerationGroup[]>('groups');
    setGroups(value);
    if (id) setEditing(value.find((group) => group.id === id) || null);
    return value;
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(!cachedAdminRead('groups'));
    void adminRequest<ModerationGroup[]>('groups', undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setGroups(value);
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) { setGroups([]); setError(failure.message); }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  useEffect(() => {
    if (confirmation) confirmDialog.current?.showModal();
    else confirmDialog.current?.close();
  }, [confirmation]);
  function open(group: ModerationGroup) {
    setEditing({ ...group });
    setTab(group.id ? 'members' : 'permissions');
    setMemberFilter('');
    setError('');
    setNotice('');
    const url = new URL(location.href);
    url.searchParams.set('view', 'team');
    url.searchParams.set('group', group.id || 'new');
    history.pushState(null, '', url);
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const read = () => {
      const id = new URLSearchParams(location.search).get('group');
      setEditing(id === 'new' ? { ...empty } : groups.find((group) => group.id === id) || null);
      setTab(id === 'new' ? 'permissions' : 'members');
      setModal(null);
      setConfirmation(null);
      setError('');
    };
    window.addEventListener('popstate', read);
    if (groups.length && !editing) read();
    return () => window.removeEventListener('popstate', read);
  }, [groups]);
  function back() {
    setEditing(null);
    setError('');
    setNotice('');
    const url = new URL(location.href);
    url.searchParams.delete('group');
    history.pushState(null, '', url);
  }
  function toggle(value: ModerationPermission, checked: boolean) {
    if (!editing) return;
    let next = checked
      ? [...editing.permissions, value]
      : editing.permissions.filter((entry) => entry !== value);
    if (!checked && value.endsWith('.view'))
      next = next.filter((entry) => !entry.startsWith(value.split('.')[0] + '.'));
    setEditing({ ...editing, permissions: normalizePermissions(next) });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await adminRequest<{ id: string }>('groups', {
        ...(editing.id ? { id: editing.id } : {}),
        name: editing.name,
        boards: editing.boards,
        permissions: editing.permissions,
      });
      await refresh(result.id);
      setTab(editing.id ? 'permissions' : 'members');
      const url = new URL(location.href);
      url.searchParams.set('group', result.id);
      history.replaceState(null, '', url);
      setNotice(editing.id ? '更改已保存' : '群组已创建');
      onAccessChange?.();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function showAdd(mode: 'add' | 'transfer') {
    searchSequence.current++;
    setSearching(false);
    setMemberQuery('');
    setCandidates([]);
    setSelected([]);
    setSearched(false);
    setAssignedBoards([]);
    setError('');
    setModal(mode);
    void searchMembers();
  }
  async function searchMembers() {
    const sequence = ++searchSequence.current;
    setSearching(true);
    setError('');
    try {
      const users: AdminItem[] = [];
      let page = 1;
      let total = 0;
      do {
        const result = await adminRequest<AdminList>(
          'items?' + new URLSearchParams({ section: 'users', status: 'all', page: String(page) }),
        );
        if (sequence !== searchSequence.current) return;
        users.push(...result.items);
        total = result.total;
        page++;
        setCandidates([
          ...new Map(
            users
              .filter((item) => item.handle && item.status !== 'deleted')
              .map((item) => [item.id, item]),
          ).values(),
        ]);
      } while ((page - 1) * 25 < total);
      setSearched(true);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      if (sequence === searchSequence.current) setSearching(false);
    }
  }
  async function changeMembers(userIds: string[], member: boolean) {
    if (!editing) return;
    await adminRequest('groups/members', {
      groupId: editing.id,
      userIds,
      member,
      ...(editing.id === moderatorGroupId && member ? { boards: assignedBoards } : {}),
    });
    await refresh(editing.id);
    setModal(null);
    setNotice(member ? editing.id === moderatorGroupId ? '版主邀请已发送，接受后生效' : '成员已添加' : '成员已移除');
    onAccessChange?.();
  }
  async function remove(handle: string) {
    const user = editing?.memberDetails?.find((item) => item.handle === handle);
    if (!user) throw new Error('用户已变更，请刷新后重试');
    await changeMembers([user.id], false);
  }
  async function execute(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await run();
      setConfirmation(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const fixed = editing?.id === 'everyone' || editing?.id === 'admin';
  const moderator = editing?.id === moderatorGroupId;
  const visibleCandidates = candidates.filter((item) =>
    (item.title + ' ' + item.handle).toLowerCase().includes(memberQuery.trim().toLowerCase()),
  );
  function toggleBoard(slug: ModerationGroup['boards'][number], checked: boolean) {
    setAssignedBoards((current) =>
      checked ? [...current, slug] : current.filter((value) => value !== slug),
    );
  }
  function showBoards(handle: string) {
    const user = editing?.memberDetails?.find((item) => item.handle === handle);
    if (!user) return;
    setAssignmentUser(user);
    setAssignedBoards([...new Set([...(user.boards || []), ...(editing?.invitations?.filter(invitation => invitation.userId === user.id).map(invitation => invitation.board) || [])])]);
    setError('');
    setModal('boards');
  }
  async function saveBoards() {
    if (!editing || !assignmentUser) return;
    await adminRequest('groups/boards', { userIds: [assignmentUser.id], boards: assignedBoards });
    await refresh(editing.id);
    setModal(null);
    setNotice('负责社区已更新，新增社区需接受邀请后生效');
    onAccessChange?.();
  }
  const canMembers = editing && editing.id !== 'everyone' && (editing.id !== 'admin' || owner);
  const results = groups.filter(
    (group) =>
      group.name.toLowerCase().includes(query.toLowerCase()) &&
      (kind === 'all' || Boolean(group.builtin) === (kind === 'builtin')),
  );
  const memberNames =
    editing?.members.filter((handle) => {
      const user = editing.memberDetails?.find((item) => item.handle === handle);
      return (handle + ' ' + (user?.nickname || ''))
        .toLowerCase()
        .includes(memberFilter.toLowerCase());
    }) || [];

  return (
    <section className="admin-groups" aria-label="群组管理">
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && <p>正在加载群组…</p>}
      {!editing ? (
        <>
          <div className="admin-filters">
            <input
              type="search"
              aria-label="搜索群组"
              placeholder="搜索群组"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label="群组类型"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="all">所有群组</option>
              <option value="builtin">默认群组</option>
              <option value="custom">自定义群组</option>
            </select>
            <button className="admin-primary" onClick={() => open({ ...empty })}>
              <Plus size={16} />
              新建群组
            </button>
          </div>
          <div className="admin-table-scroll">
            <table className="admin-queue-table">
              <thead>
                <tr>
                  <th>群组名称</th>
                  <th>负责社区</th>
                  <th>成员数</th>
                </tr>
              </thead>
              <tbody>
                {results.map((group) => (
                  <tr key={group.id}>
                    <td>
                      <button className="admin-user-link" onClick={() => open(group)}>
                        {group.name}
                      </button>
                    </td>
                    <td>
                      {['everyone', 'admin'].includes(group.id)
                        ? '全站'
                        : group.boards
                            .map(
                              (slug) => boards.find((entry) => entry.slug === slug)?.name || slug,
                            )
                            .join('、') || '未分配'}
                    </td>
                    <td>{group.members.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && !results.length && <p className="admin-empty">没有符合条件的群组</p>}
        </>
      ) : (
        <div className="admin-group-detail">
          <button disabled={busy} onClick={back}>
            <ChevronLeft size={16} />
            返回群组列表
          </button>
          <header className="admin-group-heading">
            <h1>{editing.id ? editing.name : '新建群组'}</h1>
          </header>
          {editing.id && (
            <nav className="admin-tabs" aria-label="群组详情">
              <button
                aria-current={tab === 'members' ? 'page' : undefined}
                onClick={() => setTab('members')}
              >
                成员
              </button>
              <button
                aria-current={tab === 'permissions' ? 'page' : undefined}
                onClick={() => setTab('permissions')}
              >
                {moderator ? '操作权限' : '权限与社区'}
              </button>
            </nav>
          )}
          {tab === 'members' ? (
            <>
              <div className="admin-filters">
                <input
                  type="search"
                  aria-label="搜索群组成员"
                  placeholder="搜索成员昵称或用户名"
                  value={memberFilter}
                  onChange={(event) => setMemberFilter(event.target.value)}
                />
                {canMembers && (
                  <button className="admin-primary" disabled={busy} onClick={() => showAdd('add')}>
                    <Plus size={16} />
                    {moderator ? '邀请版主' : '添加成员'}
                  </button>
                )}
                {editing.id === 'admin' && owner && (
                  <button disabled={busy} onClick={() => showAdd('transfer')}>
                    转让站点
                  </button>
                )}
              </div>
              <table className="admin-queue-table">
                <thead>
                  <tr>
                    <th>成员</th>
                    <th>{moderator ? '负责社区' : '身份'}</th>
                    {canMembers && <th>操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {memberNames.map((handle) => (
                    <tr key={handle}>
                      <td>
                        <strong>
                          {editing.memberDetails?.find((item) => item.handle === handle)
                            ?.nickname || handle}
                        </strong>
                        <small>@{handle}</small>
                      </td>
                      <td>
                        {moderator
                          ? editing.memberDetails
                              ?.find((user) => user.handle === handle)
                              ?.boards?.map(
                                (slug) => boards.find((board) => board.slug === slug)?.name || slug,
                              )
                              .join('、') || '未分配'
                          : editing.owners?.includes(handle)
                            ? '超级管理员'
                            : editing.name}
                      </td>
                      {canMembers && (
                        <td>
                          {moderator && (
                            <button disabled={busy} onClick={() => showBoards(handle)}>
                              分配社区
                            </button>
                          )}
                          {!editing.owners?.includes(handle) && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                setConfirmation({
                                  title: '从「' + editing.name + '」移除 ' + handle + '？',
                                  run: () => remove(handle),
                                })
                              }
                            >
                              移除
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!memberNames.length && (
                <p className="admin-empty">{memberFilter ? '没有符合条件的成员' : '暂无成员'}</p>
              )}
              {moderator && Boolean(editing.invitations?.length) && (
                <>
                  <h3>待接受邀请</h3>
                  <table className="admin-queue-table">
                    <thead><tr><th>受邀用户</th><th>负责社区</th><th>操作</th></tr></thead>
                    <tbody>{editing.invitations?.map(invitation => <tr key={invitation.id}>
                      <td><strong>{invitation.nickname}</strong><small>@{invitation.handle}</small></td>
                      <td>{boards.find(board => board.slug === invitation.board)?.name || invitation.board}</td>
                      <td><button disabled={busy} onClick={() => void execute(async () => {
                        await governanceRequest('moderator-invitations/withdraw', { id: invitation.id });
                        await refresh(editing.id);
                        setNotice('邀请已撤回');
                      })}>撤回邀请</button></td>
                    </tr>)}</tbody>
                  </table>
                </>
              )}
            </>
          ) : fixed ? (
            <section className="admin-fixed-group">
              <h2>负责范围</h2>
              <p>全站</p>
              <h2>权限</h2>
              <p>
                {editing.id === 'everyone'
                  ? '普通社区使用权限，所有有效注册用户自动归属。'
                  : '全站内容、用户、群组与站点设置管理。管理员任免和站点转让由超级管理员执行。'}
              </p>
            </section>
          ) : (
            <form className="admin-group-settings" onSubmit={save}>
              <fieldset disabled={busy}>
                <label className="admin-group-name">
                  群组名称
                  <input
                    required
                    minLength={2}
                    maxLength={80}
                    readOnly={editing.id === moderatorGroupId}
                    value={editing.name}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  />
                </label>
                {!editing.id && (
                  <label className="admin-group-name">
                    职责模板
                    <select
                      defaultValue=""
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          permissions: permissionTemplates[event.target.value] || [],
                        })
                      }
                    >
                      <option value="">完全自定义</option>
                      {Object.keys(permissionTemplates).map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                )}
                {!moderator && (
                  <section>
                    <h2>负责社区</h2>
                    <div className="admin-group-options">
                      {boards.map((entry) => (
                        <label key={entry.slug}>
                          <input
                            type="checkbox"
                            checked={editing.boards.includes(entry.slug)}
                            onChange={(event) =>
                              setEditing({
                                ...editing,
                                boards: event.target.checked
                                  ? [...editing.boards, entry.slug]
                                  : editing.boards.filter((slug) => slug !== entry.slug),
                              })
                            }
                          />
                          {entry.name}
                        </label>
                      ))}
                    </div>
                  </section>
                )}
                <section>
                  <h2>操作权限</h2>
                  {categories.map(([id, title]) => (
                    <div className="admin-permission-category" key={id}>
                      <h3>{title}</h3>
                      <div className="admin-group-options">
                        {moderationOperations
                          .filter((value) => value.startsWith(id + '.'))
                          .map((value) => (
                            <label key={value}>
                              <input
                                type="checkbox"
                                checked={editing.permissions.includes(value)}
                                onChange={(event) => toggle(value, event.target.checked)}
                              />
                              {permissionLabels[value]}
                            </label>
                          ))}
                      </div>
                    </div>
                  ))}
                </section>
              </fieldset>
              <div className="admin-detail-actions">
                <button className="admin-primary" disabled={busy}>
                  {editing.id ? '保存更改' : '创建群组'}
                </button>
                {editing.id && !editing.builtin && (
                  <button
                    type="button"
                    className="admin-danger"
                    disabled={busy}
                    onClick={() =>
                      setConfirmation({
                        title: '删除「' + editing.name + '」？成员将失去该群组授予的权限。',
                        run: async () => {
                          await adminRequest('groups/delete', { id: editing.id });
                          await refresh();
                          back();
                          setNotice('群组已删除');
                          onAccessChange?.();
                        },
                      })
                    }
                  >
                    删除群组
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      )}
      <dialog
        ref={dialog}
        className="admin-group-dialog"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setModal(null);
        }}
      >
        <header>
          <h2>
            {modal === 'boards'
              ? '分配社区 · ' + assignmentUser?.nickname
              : modal === 'transfer'
                ? '转让站点'
                : moderator ? '邀请版主' : '添加成员'}
          </h2>
          <button
            type="button"
            aria-label="关闭弹窗"
            disabled={busy}
            onClick={() => setModal(null)}
          >
            ×
          </button>
        </header>
        {modal !== 'boards' && (
          <div className="admin-member-search">
            <label>
              <Search size={16} />
              <input
                autoFocus
                aria-label="搜索昵称或用户名"
                placeholder="搜索昵称或用户名"
                value={memberQuery}
                onChange={(event) => setMemberQuery(event.target.value)}
              />
            </label>
          </div>
        )}
        {error && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
        {modal !== 'boards' && (
          <div className="admin-member-candidates">
            {visibleCandidates.map((item) => {
              const included = modal === 'add' && editing?.members.includes(item.handle!);
              return (
                <label key={item.id}>
                  <input
                    type={modal === 'transfer' ? 'radio' : 'checkbox'}
                    name="selected-member"
                    disabled={
                      included ||
                      busy ||
                      (modal === 'transfer' && editing?.owners?.includes(item.handle!))
                    }
                    checked={Boolean(included || selected.some((user) => user.id === item.id))}
                    onChange={(event) =>
                      setSelected((current) =>
                        modal === 'transfer'
                          ? [item]
                          : event.target.checked
                            ? [...current, item]
                            : current.filter((user) => user.id !== item.id),
                      )
                    }
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      @{item.handle}
                      {included ? ' · 已加入' : ''}
                    </small>
                  </span>
                </label>
              );
            })}
            {searching && <p role="status">正在加载用户…</p>}
            {searched && !visibleCandidates.length && <p>没有符合条件的用户</p>}
          </div>
        )}
        {(modal === 'boards' || (modal === 'add' && moderator)) && (
          <section className="admin-member-board-picker">
            <h3>负责社区</h3>
            <div className="admin-group-options">
              {boards.map((board) => (
                <label key={board.slug}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={assignedBoards.includes(board.slug)}
                    onChange={(event) => toggleBoard(board.slug, event.target.checked)}
                  />
                  {board.name}
                </label>
              ))}
            </div>
          </section>
        )}
        <footer>
          {modal !== 'boards' && <span>已选 {selected.length} 人</span>}
          <button disabled={busy} onClick={() => setModal(null)}>
            取消
          </button>
          <button
            className="admin-primary"
            disabled={(modal !== 'boards' && !selected.length) || (modal === 'add' && moderator && !assignedBoards.length) || busy}
            onClick={() => {
              if (modal === 'boards') void execute(saveBoards);
              else if (modal === 'transfer')
                setConfirmation({
                  title: '将站点转让给 ' + selected[0].title + '？转让后你将保留全站管理员身份。',
                  run: async () => {
                    await adminRequest('ownership/transfer', { userId: selected[0].id });
                    location.reload();
                  },
                });
              else if (editing?.id === 'admin')
                setConfirmation({
                  title: '授予所选 ' + selected.length + ' 人全站管理员权限？',
                  run: () =>
                    changeMembers(
                      selected.map((item) => item.id),
                      true,
                    ),
                });
              else
                void execute(() =>
                  changeMembers(
                    selected.map((item) => item.id),
                    true,
                  ),
                );
            }}
          >
            {modal === 'boards' ? '保存更改' : modal === 'transfer' ? '确认转让' : moderator ? '发送邀请' : '添加成员'}
          </button>
        </footer>
      </dialog>
      <dialog
        ref={confirmDialog}
        className="admin-group-dialog admin-group-confirm"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setConfirmation(null);
        }}
      >
        <h2>确认操作</h2>
        <p>{confirmation?.title}</p>
        {error && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
        <footer>
          <button disabled={busy} onClick={() => setConfirmation(null)}>
            取消
          </button>
          <button
            className="admin-primary"
            disabled={busy}
            onClick={() => confirmation && void execute(confirmation.run)}
          >
            {busy ? '正在处理…' : '确认'}
          </button>
        </footer>
      </dialog>
    </section>
  );
}
