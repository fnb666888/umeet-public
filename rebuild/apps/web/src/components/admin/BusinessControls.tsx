'use client';
import { useState } from 'react';
import type {
  AdminAction,
  AdminItem,
  AdminSection,
} from '../../../../../packages/contracts/src/admin';

export type ActionChoice = AdminAction extends infer T
  ? T extends AdminAction
    ? Omit<T, 'id' | 'reason'>
    : never
  : never;
export function BusinessControls({
  item,
  section,
  board,
  choose,
}: {
  item: AdminItem;
  section: AdminSection;
  board: string;
  choose: (action: ActionChoice) => void;
}) {
  const [capability, setCapability] = useState<
    'warning' | 'publish' | 'messages' | 'wiki' | 'profile' | 'suspension'
  >('warning');
  const [hours, setHours] = useState(24);
  const [revision, setRevision] = useState(item.wiki?.revisions || 1);
  const [title, setTitle] = useState(item.title);
  const [protection, setProtection] = useState<'open' | 'trusted' | 'staff'>(
    item.wiki?.protection || (item.protected ? 'staff' : 'open'),
  );
  const [quality, setQuality] = useState<'none' | 'sources' | 'outdated' | 'disputed'>(
    (item.wiki?.quality || 'none') as 'none' | 'sources' | 'outdated' | 'disputed',
  );
  if (item.manageable === false) return null;
  if (
    (section !== 'users' && section !== 'wiki') ||
    (section === 'users' && item.status === 'deleted')
  )
    return null;
  return (
    <section className="admin-business-controls">
      {section === 'users' && item.status !== 'deleted' && (
        <>
          <h3>当前限制</h3>
          {!item.penalties?.length && !item.until && <p className="admin-help">无当前限制</p>}
          {item.penalties?.map((p) => (
            <article key={p.id}>
              <p>
                {
                  {
                    warning: '警告',
                    publish: '发布限制',
                    messages: '私信限制',
                    wiki: 'Wiki 限制',
                    profile: '资料限制',
                    suspension: '封禁',
                  }[p.capability]
                }{' '}
                · {p.reason}
              </p>
              <small>{p.until ? new Date(p.until).toLocaleString('zh-CN') : '长期有效'}</small>
              <button onClick={() => choose({ action: 'penalty.revoke', target: p.id })}>
                解除此项处置
              </button>
            </article>
          ))}
          <h3>新增处置</h3>
          <label>
            限制功能
            <select
              value={capability}
              onChange={(event) => setCapability(event.target.value as typeof capability)}
            >
              <option value="warning">正式警告</option>
              <option value="publish">发布帖子与回复</option>
              <option value="wiki">Wiki 编辑与讨论</option>
              {!board && (
                <>
                  <option value="messages">发送私信</option>
                  <option value="profile">修改资料</option>
                </>
              )}
              <option value="suspension">{board ? '社区封禁' : '账号封禁'}</option>
            </select>
          </label>
          {capability !== 'warning' && (
            <label>
              有效期
              <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
                <option value={1}>1 小时</option>
                <option value={24}>24 小时</option>
                <option value={168}>7 天</option>
                <option value={720}>30 天</option>
                <option value={0}>长期有效</option>
              </select>
            </label>
          )}
          <button
            onClick={() =>
              choose({
                action: 'penalty',
                target: item.target,
                capability,
                hours: capability === 'warning' ? 0 : hours,
              })
            }
          >
            记录处置
          </button>
        </>
      )}
      {section === 'wiki' && item.wiki && (
        <>
          <h3>Wiki 治理</h3>
          <label>
            编辑权限
            <select
              value={protection}
              onChange={(event) => setProtection(event.target.value as typeof protection)}
            >
              <option value="open">所有已登录用户</option>
              <option value="trusted">注册满 7 天且无有效处罚的用户</option>
              <option value="staff">社区管理人员</option>
            </select>
          </label>
          <label>
            保护期限
            <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
              <option value={24}>24 小时</option>
              <option value={168}>7 天</option>
              <option value={0}>长期有效</option>
            </select>
          </label>
          <button
            onClick={() =>
              choose({ action: 'wiki.manage', target: item.target, protection, hours })
            }
          >
            保存保护规则
          </button>
          <label>
            质量标记
            <select
              value={quality}
              onChange={(event) => setQuality(event.target.value as typeof quality)}
            >
              <option value="none">无标记</option>
              <option value="sources">需要来源</option>
              <option value="outdated">信息过时</option>
              <option value="disputed">内容争议</option>
            </select>
          </label>
          <button
            onClick={() =>
              choose({ action: 'wiki.manage', target: item.target, quality, hours: 0 })
            }
          >
            保存质量标记
          </button>
          <label>
            词条标题
            <input
              value={title}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <button
            disabled={!title.trim() || title.trim() === item.title}
            onClick={() =>
              choose({ action: 'wiki.manage', target: item.target, title: title.trim(), hours: 0 })
            }
          >
            重命名词条
          </button>
          <label>
            修订版本
            <select value={revision} onChange={(event) => setRevision(Number(event.target.value))}>
              {item.wiki.history.map((entry, index) => (
                <option key={index} value={item.wiki!.revisions - index}>
                  v{item.wiki!.revisions - index} · {String(entry['reason'] || '更新')}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() =>
              choose({
                action: 'wiki.manage',
                target: item.target,
                revision,
                patrolled: !item.wiki?.patrolledRevisions?.includes(revision),
                hours: 0,
              })
            }
          >
            {item.wiki.patrolledRevisions?.includes(revision) ? '取消已巡查' : '标记已巡查'}
          </button>
          {!board && (
            <button
              disabled={revision === item.wiki.revisions}
              onClick={() =>
                choose({
                  action: 'wiki.manage',
                  target: item.target,
                  revision,
                  hidden: !item.wiki?.hiddenRevisions?.includes(revision),
                  hours: 0,
                })
              }
            >
              {item.wiki.hiddenRevisions?.includes(revision) ? '恢复历史可见' : '隐藏敏感修订'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
