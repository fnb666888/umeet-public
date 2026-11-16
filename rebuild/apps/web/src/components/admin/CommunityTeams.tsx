'use client';
import { useEffect, useRef, useState } from 'react';
import { governanceRequest, cachedGovernance } from '../community/governance-client';
import { boards } from '../community/model';
import {
  moderationOperations,
  normalizePermissions,
  permissionLabels,
  type ModerationPermission,
} from '../../../../../packages/contracts/src/moderation-permissions';

type Member = {
  user_id: string;
  nickname: string;
  handle: string | null;
  permissions: ModerationPermission[];
  state: string;
  version: number;
};
type Team = {
  id: string;
  name: string;
  board: string;
  owner_id: string;
  state: string;
  version: number;
  canManage: boolean;
  canTransfer: boolean;
  availablePermissions: ModerationPermission[];
  members: Member[];
};
type User = { id: string; nickname: string; handle: string | null };
const operations = moderationOperations.filter(
  (value) => !['teams.manage', 'boards.edit', 'appeals.view', 'appeals.review'].includes(value),
);
export function CommunityTeams({
  board,
  allowCreate = true,
}: {
  board: string;
  allowCreate?: boolean;
}) {
  const [teams, setTeams] = useState<Team[]>(() => cachedGovernance<Team[]>('teams' + (board ? '?board=' + board : '')) ?? []);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [invite, setInvite] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<ModerationPermission[]>([]);
  const [editing, setEditing] = useState<Member | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [owners, setOwners] = useState<User[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const team = teams.find((value) => value.id === selected);
  useEffect(() => {
    setOwners([]);
    if (team?.canTransfer)
      void governanceRequest<User[]>('team-owners?board=' + team.board)
        .then(setOwners)
        .catch((error) => setError(error.message));
  }, [team?.id, team?.board, team?.canTransfer]);
  async function load() {
    setTeams(await governanceRequest<Team[]>('teams' + (board ? '?board=' + board : '')));
  }
  useEffect(() => {
    function read() {
      setSelected(new URLSearchParams(location.search).get('communityTeam') || '');
      setInvite(false);
    }
    read();
    window.addEventListener('popstate', read);
    void load().catch((error) => { setTeams([]); setError(error.message); });
    return () => window.removeEventListener('popstate', read);
  }, [board]);
  useEffect(() => {
    if (invite) dialog.current?.showModal();
  }, [invite]);
  function selectTeam(id: string) {
    const url = new URL(location.href);
    if (id) url.searchParams.set('communityTeam', id);
    else url.searchParams.delete('communityTeam');
    history.pushState(null, '', url);
    setSelected(id);
  }
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function back() {
    selectTeam('');
    setInvite(false);
    setEditing(null);
  }
  async function openInvite() {
    setError('');
    try {
      setUsers(await governanceRequest<User[]>('users?board=' + team!.board));
      setChosen([]);
      setPermissions([]);
      setEditing(null);
      setSearch('');
      setInvite(true);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const toggle = (permission: ModerationPermission) =>
    setPermissions((values) =>
      values.includes(permission)
        ? values.filter(
            (value) =>
              value !== permission &&
              !(permission.endsWith('.view') && value.startsWith(permission.split('.')[0] + '.')),
          )
        : normalizePermissions([...values, permission]),
    );
  return (
    <section className="admin-groups">
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {team ? (
        <>
          <button className="admin-back" onClick={back}>
            ← 返回管理团队
          </button>
          <h2>{team.name}</h2>
          {team.state === 'suspended' && <p role="status">团队权限已暂停，等待全站管理员转交。</p>}
          <p>{boards.find((board) => board.slug === team.board)?.name || team.board}</p>
          {team.canManage && team.state === 'active' && (
            <button disabled={busy} onClick={() => void openInvite()}>
              邀请助手
            </button>
          )}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>权限</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {team.members.map((member) => (
                  <tr key={member.user_id}>
                    <td>
                      {member.nickname}
                      <small>@{member.handle}</small>
                    </td>
                    <td>
                      {member.permissions
                        .map(
                          (permission) =>
                            permissionLabels[permission as keyof typeof permissionLabels],
                        )
                        .filter(Boolean)
                        .join('、') || '暂无权限'}
                    </td>
                    <td>
                      {{ invited: '待接受', active: '已加入', exit_requested: '申请退出' }[
                        member.state
                      ] || member.state}
                    </td>
                    <td>
                      {team.canManage && (
                        <>
                          <button
                            onClick={() => {
                              setEditing(member);
                              setPermissions(member.permissions);
                              setInvite(true);
                            }}
                          >
                            调整权限
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  member.state === 'exit_requested'
                                    ? '确认批准退出？'
                                    : '确认移除该成员？',
                                )
                              )
                                void run(() =>
                                  governanceRequest('teams/change', {
                                    teamId: team.id,
                                    version: team.version,
                                    userId: member.user_id,
                                    action:
                                      member.state === 'exit_requested' ? 'approve-exit' : 'remove',
                                    permissions: [],
                                  }),
                                );
                            }}
                          >
                            {member.state === 'exit_requested' ? '批准退出' : '移除'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {team.canTransfer && (
            <form
              className="admin-toolbar"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                if (confirm('确认将团队转交给所选版主？团队权限将按新创建者的权限调整。'))
                  void run(() =>
                    governanceRequest('teams/change', {
                      teamId: team.id,
                      version: team.version,
                      action: 'transfer',
                      userId: form.get('userId'),
                      permissions: [],
                    }),
                  );
              }}
            >
              <label>
                转交给版主
                <select name="userId" required defaultValue="">
                  <option value="" disabled>
                    选择本板块版主
                  </option>
                  {owners
                    .filter((owner) => owner.id !== team.owner_id)
                    .map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.nickname} @{owner.handle}
                      </option>
                    ))}
                </select>
              </label>
              <button disabled={busy || !owners.some((owner) => owner.id !== team.owner_id)}>
                确认转交
              </button>
            </form>
          )}
          {!team.members.length && <p className="admin-empty">暂无成员</p>}
        </>
      ) : (
        <>
          <h2>管理团队</h2>
          <p className="admin-help">团队由板块版主创建，用于邀请助手并分配工作；权限群组用于定义管理权限。</p>
          {!teams.length && <p className="admin-empty">暂无管理团队。{allowCreate && board ? '填写团队名称即可创建自己的团队。' : '由负责板块的版主在社区工作台创建团队。'}</p>}
          {allowCreate && board && (
            <form
              className="admin-toolbar"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() =>
                  governanceRequest('teams', { id: crypto.randomUUID(), board, name }),
                ).then(() => setName(''));
              }}
            >
              <input
                aria-label="团队名称"
                placeholder="团队名称"
                maxLength={40}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <button disabled={busy}>创建团队</button>
            </form>
          )}
          {teams.length > 0 && <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>团队</th>
                  <th>板块</th>
                  <th>成员数</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => (
                  <tr key={team.id}>
                    <td>
                      <button onClick={() => selectTeam(team.id)}>{team.name}</button>
                    </td>
                    <td>{boards.find((board) => board.slug === team.board)?.name || team.board}</td>
                    <td>{team.members.filter((member) => member.state !== 'invited').length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </>
      )}
      {invite && team && (
        <dialog ref={dialog} onCancel={() => setInvite(false)} className="admin-group-dialog">
          <header>
            <h3>{editing ? '调整权限' : '邀请助手'}</h3>
            <button aria-label="关闭" onClick={() => setInvite(false)}>
              ×
            </button>
          </header>
          {!editing && (
            <>
              <input
                aria-label="搜索用户"
                placeholder="昵称或用户名"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="governance-user-options">
                {users
                  .filter(
                    (user) =>
                      !team.members.some((member) => member.user_id === user.id) &&
                      (user.nickname + ' ' + user.handle)
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
                  .map((user) => (
                    <label key={user.id}>
                      <input
                        type="checkbox"
                        checked={chosen.includes(user.id)}
                        onChange={() =>
                          setChosen((values) =>
                            values.includes(user.id)
                              ? values.filter((value) => value !== user.id)
                              : [...values, user.id],
                          )
                        }
                      />
                      {user.nickname} <small>@{user.handle}</small>
                    </label>
                  ))}
              </div>
            </>
          )}
          <fieldset>
            <legend>授予权限</legend>
            <div className="governance-permissions">
              {operations
                .filter((permission) => team.availablePermissions.includes(permission))
                .map((permission) => (
                  <label key={permission}>
                    <input
                      type="checkbox"
                      checked={permissions.includes(permission)}
                      onChange={() => toggle(permission)}
                    />
                    {permissionLabels[permission]}
                  </label>
                ))}
            </div>
          </fieldset>
          <footer>
            <button onClick={() => setInvite(false)}>取消</button>
            <button
              disabled={busy || (!editing && !chosen.length)}
              onClick={() =>
                void run(async () => {
                  let version = team.version;
                  for (const userId of editing ? [editing.user_id] : chosen) {
                    const result = await governanceRequest<{ version: number }>('teams/change', {
                      teamId: team.id,
                      version,
                      userId,
                      action: editing ? 'permissions' : 'invite',
                      permissions,
                    });
                    version = result.version;
                    setChosen((values) => values.filter((value) => value !== userId));
                  }
                  setInvite(false);
                })
              }
            >
              {editing ? '保存更改' : '发送邀请'}
            </button>
          </footer>
        </dialog>
      )}
    </section>
  );
}
