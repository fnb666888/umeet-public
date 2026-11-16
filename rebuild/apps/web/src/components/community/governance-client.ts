import { ResourceDomain, invalidateResources } from '../../lib/resources';
export const governanceResources = new ResourceDomain('community-governance');
export const cachedGovernance = <T,>(path: string) => governanceResources.peek<T>(path);
export async function governanceRequest<T>(path: string, body?: unknown): Promise<T> {
  if (body !== undefined) {
    invalidateResources(undefined, false);
    try { return await sendGovernance<T>(path, body); }
    finally { invalidateResources(); }
  }
  return governanceResources.read(path, () => sendGovernance<T>(path));
}
async function sendGovernance<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/backend/community-governance/' + path, {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  if (!response.ok) {
    const messages: Record<string, string> = {
      TEAM_VERSION_CONFLICT: '团队已发生变化，请刷新后重试',
      APPLICATION_VERSION_CONFLICT: '申请已更新，请刷新后重试',
      APPLICATION_ALREADY_PENDING: '你已提交该板块的版主申请',
      PERMISSION_ESCALATION: '所选权限超出团队创建者的授权范围',
      INVITATION_PERMISSIONS_CHANGED: '邀请权限已变化，请联系创建者更新邀请后重新确认',
      TEAM_SUSPENDED: '团队权限已暂停，请联系全站管理员',
      BOARD_SLUG_EXISTS: '该板块标识已被使用',
      BOARD_MODERATOR_EXISTS: '该板块已有版主',
      BOARD_MODERATOR_REQUIRED: '该板块需要先由全站管理员指定版主',
      MANAGEMENT_INVITATION_REQUIRED: '版主和助手采用邀请制，请等待管理人员邀请',
      MODERATOR_BOARDS_REQUIRED: '请为受邀版主选择负责的社区',
      MODERATOR_INVITATION_REQUIRED: '请通过邀请版主添加成员',
      INVITATION_NOT_PENDING: '邀请已被处理或撤回，请刷新后查看',
      INVITATION_NOT_YOURS: '这份邀请属于其他用户',
      SELECT_ACTIVE_OWN_TEAM: '请选择你在该板块创建的有效团队',
      APPLICATION_MATERIALS_REQUIRED: '请补全申请理由、板块简介与规则或管理设想',
      MODERATOR_REQUIRED: '需要本板块的版主权限',
      SETTINGS_VERSION_CONFLICT: '设置已更新，请刷新后重新编辑',
    };
    const reason = value.message?.message ?? value.message;
    throw Object.assign(new Error(
      value.eligibility?.blockReasons?.join('，') ||
        messages[reason] ||
        (response.status === 403 ? '当前账号没有操作权限' : '操作未完成，请刷新后重试'),
    ), {status:response.status});
  }
  return value as T;
}
