'use client';
import { SiteLink as Link } from '../SiteLink';
import { useState } from 'react';
import type {
  KnowledgeProposal,
  KnowledgeCapabilities,
} from '../../../../../packages/contracts/src/knowledge';
import { useKnowledge, useKnowledgeCapabilities } from './useKnowledge';
import { KnowledgeHeader, KnowledgeStatus, LoginNotice, formatTime } from './KnowledgeUI';
import { KnowledgeReviewQueue } from './KnowledgeReviewQueue';
import { KnowledgeGovernance } from './KnowledgeGovernance';
import { OrganizationReviewQueue } from './OrganizationReviewQueue';
export function KnowledgeManagement() {
  const caps = useKnowledgeCapabilities();
  return (
    <div className="knowledge">
      <KnowledgeHeader
        title="我的贡献与管理"
        description="恢复私人草稿，查看审核进度，参与知识库维护。"
      />
      <KnowledgeStatus
        loading={!caps.data && caps.loading}
        error={caps.error}
        retry={caps.reload}
      />
      {caps.data &&
        (caps.cap.canContribute ? (
          <ManagementContent key={caps.cap.accountId} cap={caps.cap} />
        ) : (
          <LoginNotice />
        ))}
    </div>
  );
}
function ManagementContent({ cap }: { cap: KnowledgeCapabilities }) {
  const [tab, setTab] = useState<'contributions' | 'organization' | 'governance'>('contributions'),
    [communityId, setCommunityId] = useState(''),
    [filter, setFilter] = useState<'all' | 'pending' | 'returned' | 'approved'>('all'),
    [cursor, setCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<KnowledgeProposal[]>([]);
  const proposals = useKnowledge<KnowledgeProposal[]>(
      'proposals?limit=50&state=' +
        filter +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
    ),
    drafts = useKnowledge<
      {
        id: string;
        editingTaskId: string;
        pageId: string | null;
        updatedAt: string;
        title: string;
      }[]
    >('drafts'),
    communities = useKnowledge<{ id: string; name: string; slug: string }[]>('communities');
  const localCaps = useKnowledgeCapabilities(communityId || undefined);
  const displayed = [
    ...new Map([...previous, ...(proposals.data ?? [])].map((p) => [p.id, p])).values(),
  ];
  return (
    <>
      <div className="knowledge-tabs" role="tablist" aria-label="贡献与管理">
        <button
          role="tab"
          aria-selected={tab === 'contributions'}
          onClick={() => setTab('contributions')}
        >
          {cap.canGovernBody ? '正文审核与我的草稿' : '我的修改与草稿'}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'organization'}
          onClick={() => setTab('organization')}
        >
          社区目录与路线建议
        </button>
        {cap.canGovernBody && (
          <button
            role="tab"
            aria-selected={tab === 'governance'}
            onClick={() => setTab('governance')}
          >
            争议与隐藏管理
          </button>
        )}
      </div>
      {tab === 'contributions' ? (
        <>
          <section className="knowledge-form-section">
            <h2>我的私人草稿</h2>
            <KnowledgeStatus loading={drafts.loading} error={drafts.error} retry={drafts.reload} />
            {drafts.data?.map((d) => (
              <Link
                className="knowledge-draft-link"
                key={d.id}
                href={
                  (d.pageId ? '/knowledge/' + d.pageId + '/edit' : '/knowledge/new') +
                  '?task=' +
                  encodeURIComponent(d.editingTaskId)
                }
              >
                <strong>{d.title || '未命名词条'} · 继续编辑</strong>
                <span>保存于 {formatTime(d.updatedAt)}</span>
              </Link>
            ))}
            {drafts.data?.length === 0 && <p className="knowledge-muted">没有未完成的私人草稿。</p>}
          </section>
          <section>
            <div className="knowledge-row">
              <h2 className="knowledge-grow">
                {cap.canGovernBody ? '全站词条修改' : '我提交的修改'}
              </h2>
              <label>
                审核状态
                <select
                  aria-label="审核状态"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value as typeof filter);
                    setPrevious([]);
                    setCursor(null);
                  }}
                >
                  <option value="all">全部状态</option>
                  <option value="pending">待审核</option>
                  <option value="returned">已退回</option>
                  <option value="approved">已批准</option>
                </select>
              </label>
            </div>
            <KnowledgeStatus
              loading={proposals.loading}
              error={proposals.error}
              retry={proposals.reload}
            />
            {proposals.data && (
              <KnowledgeReviewQueue
                proposals={displayed}
                cap={cap}
                onChanged={() => {
                  setPrevious([]);
                  setCursor(null);
                  proposals.reload();
                  drafts.reload();
                }}
              />
            )}
            {proposals.data?.length === 50 && (
              <button
                className="knowledge-button"
                onClick={() => {
                  setPrevious(displayed);
                  setCursor(proposals.data![proposals.data!.length - 1]!.id);
                }}
              >
                加载更多修改记录
              </button>
            )}
          </section>
        </>
      ) : tab === 'organization' ? (
        <>
          <label>
            选择社区
            <select
              aria-label="选择社区"
              value={communityId}
              onChange={(e) => setCommunityId(e.target.value)}
            >
              <option value="">请选择社区</option>
              {communities.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {communityId && (
            <>
              <p>
                <Link
                  href={
                    '/c/' + communities.data?.find((c) => c.id === communityId)?.slug + '/knowledge'
                  }
                >
                  查看社区目录与学习路线
                </Link>
              </p>
              <OrganizationReviewQueue
                key={communityId}
                communityId={communityId}
                cap={localCaps.cap}
              />
            </>
          )}
        </>
      ) : (
        <KnowledgeGovernance cap={cap} />
      )}
    </>
  );
}
