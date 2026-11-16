export const moderationOperations = [
  'teams.manage',
  'boards.edit',
  'reports.view',
  'reports.dismiss',
  'reports.escalate',
  'content.view',
  'content.delete',
  'content.restore',
  'users.view',
  'users.manage',
  'appeals.view',
  'appeals.review',
  'wiki.view',
  'wiki.edit',
  'history.view',
] as const;
export const moderationPermissions = [
  'reports',
  'content',
  'users',
  'wiki',
  'history',
  ...moderationOperations,
  'users.mute',
  'users.suspend',
] as const;
export type ModerationPermission = (typeof moderationPermissions)[number];
export const moderatorGroupId = '00000000-0000-4000-8000-000000000001';
export const permissionLabels: Record<(typeof moderationOperations)[number], string> = {
  'teams.manage': '管理自己的团队',
  'boards.edit': '维护板块简介与规则',
  'reports.view': '查看举报',
  'reports.dismiss': '驳回举报',
  'reports.escalate': '转交举报',
  'content.view': '查看内容',
  'content.delete': '删除内容',
  'content.restore': '恢复内容',
  'users.view': '查看用户',
  'users.manage': '处置用户',
  'appeals.view': '查看申诉',
  'appeals.review': '复核申诉',
  'wiki.view': '查看 Wiki',
  'wiki.edit': '编辑 Wiki',
  'history.view': '查看处置记录',
};
export const permissionTemplates: Record<string, ModerationPermission[]> = {
  举报审核: ['reports.view', 'reports.dismiss', 'reports.escalate'],
  内容维护: ['content.view', 'content.delete', 'content.restore'],
  用户管理: ['users.view', 'users.manage'],
  'Wiki 维护': ['wiki.view', 'wiki.edit'],
  版主: [...moderationOperations],
};
export function normalizePermissions(
  values: readonly ModerationPermission[],
): ModerationPermission[] {
  const result = new Set<ModerationPermission>();
  for (const value of values) {
    if (value === 'users.mute' || value === 'users.suspend') result.add('users.manage');
    else if (value.includes('.')) result.add(value);
    else
      for (const operation of moderationOperations) {
        if (operation.startsWith(value + '.')) result.add(operation);
      }
  }
  for (const value of [...result]) {
    const category = value.split('.')[0];
    if (!['teams', 'boards'].includes(category!) && value !== category + '.view')
      result.add((category + '.view') as ModerationPermission);
  }
  return [...result];
}
export function permits(
  values: readonly ModerationPermission[] | undefined,
  permission: ModerationPermission,
) {
  return (
    !values ||
    normalizePermissions(values).includes(
      (permission === 'users.mute' || permission === 'users.suspend'
        ? 'users.manage'
        : permission.includes('.')
          ? permission
          : permission + '.view') as ModerationPermission,
    )
  );
}
