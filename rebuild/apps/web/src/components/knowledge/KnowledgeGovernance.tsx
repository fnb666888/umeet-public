'use client';
import { SiteLink as Link } from '../SiteLink';
import { useState } from 'react';
import type {
  KnowledgeCapabilities,
  KnowledgePage,
} from '../../../../../packages/contracts/src/knowledge';
import { useKnowledge } from './useKnowledge';
import { knowledge } from './knowledge-client';
import { KnowledgeActionDialog, type KnowledgeAction } from './KnowledgeActionDialog';
import { PagePicker, PageTitle } from './PagePicker';
import { KnowledgeStatus, formatTime } from './KnowledgeUI';
type Governance = {
  pages: { id: string; hidden: number; paused: number; purged: number; title: string | null }[];
  disputes: { id: string; page_id: string; reason: string; state: string; created_at: string }[];
  events: {
    id: string;
    page_id: string | null;
    action: string;
    reason: string;
    created_at: string;
    actorAlias: string;
  }[];
};
export function KnowledgeGovernance({ cap }: { cap: KnowledgeCapabilities }) {
  const r = useKnowledge<Governance>('governance');
  const [action, setAction] = useState<KnowledgeAction | null>(null),
    [selected, setSelected] = useState<KnowledgePage | null>(null);
  function change(
    path: string,
    title: string,
    confirm: string,
    body: Record<string, unknown> = {},
    destructive = false,
  ) {
    setAction({
      title,
      confirm,
      destructive,
      description: destructive
        ? '永久清除会删除这篇词条的正文、历史、待审内容、相关私人草稿及讨论。所有社区目录和路线中的引用将保留不可用提示；此操作不可恢复。'
        : '操作会记录理由。共享词条的状态变化会影响所有收录社区和学习路线。',
      run: async (reason) => {
        await knowledge(path, {
          method: 'POST',
          accountId: cap.accountId!,
          body: { ...body, reason },
        });
        r.reload();
        setSelected(null);
      },
    });
  }
  return (
    <section>
      <h2>共享词条治理</h2>
      <p className="knowledge-help">
        提出争议只登记问题。暂停或恢复发布由全站管理员决定，复核应记录理由和内容依据。
      </p>
      <PagePicker label="选择要处理的已发布词条" onSelect={setSelected} />
      {selected && (
        <div className="knowledge-governance-target">
          <h3>{selected.title}</h3>
          <div className="knowledge-actions">
            <Link className="knowledge-button" href={'/knowledge/' + selected.id}>
              查看正文
            </Link>
            <button
              className="knowledge-button"
              onClick={() =>
                change('pages/' + selected.id + '/disputes', '提出内容争议', '登记争议')
              }
            >
              提出争议
            </button>
            <button
              className="knowledge-button"
              onClick={() =>
                change('pages/' + selected.id + '/visibility', '隐藏共享词条', '隐藏词条', {
                  hidden: true,
                })
              }
            >
              隐藏词条
            </button>
            {cap.isSiteAdmin && (
              <button
                className="knowledge-button knowledge-danger"
                onClick={() =>
                  change(
                    'pages/' + selected.id + '/purge',
                    '永久清除共享词条',
                    '永久清除',
                    {},
                    true,
                  )
                }
              >
                永久清除
              </button>
            )}
          </div>
        </div>
      )}
      <KnowledgeStatus loading={r.loading} error={r.error} retry={r.reload} />
      <h3>隐藏或暂停发布的词条</h3>
      {r.data?.pages
        .filter((p) => !p.purged)
        .map((p) => (
          <div className="knowledge-governance-target" key={p.id}>
            <strong>{p.title ?? '尚无发布版'}</strong>
            <span className="knowledge-badge">{p.hidden ? '已隐藏' : '发布已暂停'}</span>
            <div className="knowledge-actions">
              {p.hidden && (
                <button
                  className="knowledge-button"
                  onClick={() =>
                    change('pages/' + p.id + '/visibility', '恢复共享词条', '恢复阅读', {
                      hidden: false,
                    })
                  }
                >
                  恢复阅读
                </button>
              )}
              {cap.isSiteAdmin && (
                <button
                  className="knowledge-button knowledge-danger"
                  onClick={() =>
                    change('pages/' + p.id + '/purge', '永久清除共享词条', '永久清除', {}, true)
                  }
                >
                  永久清除
                </button>
              )}
            </div>
          </div>
        ))}
      {r.data?.pages.filter((p) => !p.purged).length === 0 && (
        <p className="knowledge-muted">当前没有隐藏或暂停发布的词条。</p>
      )}
      <h3>争议记录</h3>
      {r.data?.disputes.map((d) => (
        <div className="knowledge-governance-target" key={d.id}>
          <h4>
            <PageTitle id={d.page_id} />
          </h4>
          <p>{d.reason}</p>
          <span className="knowledge-badge">
            {
              { open: '已登记', reviewing: '复核中', resolved: '已处理' }[
                d.state as 'open' | 'reviewing' | 'resolved'
              ]
            }
          </span>
          {cap.isSiteAdmin && (
            <div className="knowledge-actions">
              <button
                className="knowledge-button"
                onClick={() =>
                  change('disputes/' + d.id + '/decision', '暂停直接发布', '暂停发布', {
                    action: 'pause',
                  })
                }
              >
                暂停直接发布
              </button>
              <button
                className="knowledge-button"
                onClick={() =>
                  change('disputes/' + d.id + '/decision', '恢复直接发布', '恢复发布', {
                    action: 'resume',
                  })
                }
              >
                恢复直接发布
              </button>
              <button
                className="knowledge-button"
                onClick={() =>
                  change('disputes/' + d.id + '/decision', '结束争议复核', '记录结论并恢复发布', {
                    action: 'resolve',
                  })
                }
              >
                结束复核
              </button>
            </div>
          )}
        </div>
      ))}
      <details>
        <summary>查看最近管理记录</summary>
        {r.data?.events.map((e) => (
          <div className="knowledge-audit-row" key={e.id}>
            <span>{formatTime(e.created_at)}</span>
            <strong>{eventLabel(e.action)}</strong>
            <span>，{e.actorAlias}</span>
            <p>
              {e.action === 'directory'
                ? '已更新社区收录、目录结构或条目顺序。'
                : e.action === 'route'
                  ? '已保存学习目标、阅读顺序和导读。'
                  : e.action === 'route-confirm'
                    ? '已核对路线步骤与当时发布的正文。'
                    : e.reason}
            </p>
          </div>
        ))}
      </details>
      <KnowledgeActionDialog action={action} onClose={() => setAction(null)} />
    </section>
  );
}
function eventLabel(action: string) {
  return (
    (
      {
        publish: '发布修订',
        'review-publish': '复核发布',
        submit: '提交审核',
        approve: '批准修改',
        return: '退回修改',
        hide: '隐藏词条',
        restore: '恢复词条',
        purge: '永久清除',
        'dispute-raised': '提出争议',
        'dispute-pause': '暂停发布',
        'dispute-resume': '恢复发布',
        'dispute-resolve': '结束复核',
        'dispute-review': '记录复核依据',
        directory: '调整目录',
        route: '调整路线',
        'route-confirm': '复核路线步骤',
        'organization-approve': '批准组织建议',
        'organization-return': '退回组织建议',
      } as Record<string, string>
    )[action] ?? '管理操作'
  );
}
