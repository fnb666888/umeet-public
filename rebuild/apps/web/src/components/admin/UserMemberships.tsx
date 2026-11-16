'use client';

import { useEffect, useState } from 'react';
import type { AdminItem, ModerationGroup } from '../../../../../packages/contracts/src/admin';
import { boards } from '../community/model';
import { adminRequest } from './admin-api';
import { moderatorGroupId } from '../../../../../packages/contracts/src/moderation-permissions';

export function UserMemberships({ item }: { item: AdminItem }) {
  const [groups, setGroups] = useState<ModerationGroup[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void adminRequest<ModerationGroup[]>('groups', undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setGroups(value);
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, []);
  const belongs = (group: ModerationGroup) =>
    Boolean(item.handle && group.members.includes(item.handle));
  return (
    <section className="admin-user-memberships">
      <h3>所属群组</h3>
      {groups && !groups.some(belongs) && <p>当前未加入管理群组。</p>}
      {groups?.filter(belongs).map((group) => {
        const scope =
          group.id === moderatorGroupId
            ? group.memberDetails?.find((user) => user.id === item.id)?.boards || []
            : group.boards;
        return (
          <div className="admin-membership" key={group.id}>
            <div>
              <strong>{group.name}</strong>
              {group.id !== 'everyone' && (
                <small>
                  {scope.length
                    ? scope
                        .map((board) => boards.find((entry) => entry.slug === board)?.name || board)
                        .join('、')
                    : group.id === 'admin'
                      ? '全站权限'
                      : '未分配社区'}
                </small>
              )}
            </div>
          </div>
        );
      })}
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
