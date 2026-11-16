import type { DispositionEffect } from '../../../../packages/contracts/src/admin';
import './disposition-effects.css';

const boardNames: Record<string, string> = {
  daily: '校园日常',
  questions: '问答求助',
  market: '二手交易',
  treehole: '树洞',
  buddies: '搭子活动',
  resources: '资源共享',
};
const effectNames: Record<string, string> = {
  'content.delete': '删除内容',
  warning: '警告',
  participation: '限制参与',
  deactivation: '停用账号',
  'restriction.release': '解除限制',
};
const statuses: Record<string, string> = {
  active: '生效中',
  expired: '已到期',
  revoked: '已撤销',
  superseded: '已调整',
  recorded: '已记录',
};

export function dispositionScope(board: string | null | undefined) {
  return board ? boardNames[board] || board : '全站';
}

export function DispositionEffects({ effects }: { effects: DispositionEffect[] }) {
  return (
    <ul className="disposition-effects">
      {effects.map((effect) => (
        <li key={effect.id}>
          <strong>{effectNames[effect.type] || effect.type}</strong>
          <span>
            {dispositionScope(effect.board)} · {statuses[effect.status] || effect.status}
          </span>
          {['participation', 'deactivation'].includes(effect.type) && (
            <small>
              {effect.until ? new Date(effect.until).toLocaleString('zh-CN') + ' 到期' : '永久'}
            </small>
          )}
        </li>
      ))}
    </ul>
  );
}
