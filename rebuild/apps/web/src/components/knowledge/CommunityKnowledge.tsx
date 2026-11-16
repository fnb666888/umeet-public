'use client';
import { SiteLink as Link } from '../SiteLink';
import { useState } from 'react';
import { FolderOpen, Route } from 'lucide-react';
import type { KnowledgeCommunity } from '../../../../../packages/contracts/src/knowledge';
import { communitySlug } from '../../../../../packages/contracts/src/boards';
import { useKnowledge, useKnowledgeCapabilities } from './useKnowledge';
import { KnowledgeHeader, KnowledgeStatus, LoginNotice } from './KnowledgeUI';
import { DirectoryEditor } from './DirectoryEditor';
import { RouteEditor } from './RouteEditor';
export function CommunityKnowledge({ slug }: { slug: string }) {
  const community = useKnowledge<KnowledgeCommunity>('communities/' + encodeURIComponent(communitySlug(slug)));
  const { cap } = useKnowledgeCapabilities(community.data?.id),
    routes = useKnowledge<{ id: string; title: string; goal: string }[]>(
      'routes' + (community.data ? '?communityId=' + community.data.id : ''),
    );
  const [editing, setEditing] = useState<'directory' | 'route' | null>(null),
    [message, setMessage] = useState('');
  const c = community.data;
  function saved() {
    setEditing(null);
    setMessage(
      cap.canOrganizeCommunity ? '社区知识库已更新' : '建议已提交，等待本社区 Wiki 管理人员审核。',
    );
    community.reload();
    routes.reload();
  }
  return (
    <div className="knowledge">
      <KnowledgeStatus
        loading={community.loading}
        error={community.error}
        retry={community.reload}
      />
      {c && (
        <>
          <KnowledgeHeader
            title={c.name + ' Wiki'}
            description="在社区目录中查找，或选择一条学习路线。"
          >
            {cap.canContribute && (
              <>
                <button className="knowledge-button" onClick={() => setEditing('directory')}>
                  {cap.canOrganizeCommunity ? '维护目录' : '建议调整目录'}
                </button>
                <button
                  className="knowledge-button knowledge-primary"
                  onClick={() => setEditing('route')}
                >
                  {cap.canOrganizeCommunity ? '创建学习路线' : '建议学习路线'}
                </button>
              </>
            )}
          </KnowledgeHeader>
          {message && (
            <p role="status" className="knowledge-notice">
              {message}
            </p>
          )}
          {editing === 'directory' ? (
            <DirectoryEditor
              key={c.version}
              community={c}
              cap={cap}
              onSaved={saved}
              onCancel={() => setEditing(null)}
            />
          ) : editing === 'route' ? (
            <RouteEditor
              communityId={c.id}
              cap={cap}
              onSaved={saved}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <>
              <div className="knowledge-community-grid">
                <section>
                  <h2>
                    <FolderOpen size={20} />
                    知识目录
                  </h2>
                  {c.nodes
                    .filter((n) => !n.parentId)
                    .map((n) => (
                      <DirectoryNode key={n.id} node={n} community={c} />
                    ))}
                  {!c.nodes.length && (
                    <div className="knowledge-empty">
                      <h3>目录尚未建立</h3>
                      <p>可以按学科分支、主题或办事类型组织词条。</p>
                    </div>
                  )}
                  <h2>全部收录词条</h2>
                  <ul className="knowledge-collected">
                    {c.collections.map((p) => (
                      <li key={p.pageId}>
                        {p.available ? (
                          <Link href={'/knowledge/' + p.pageId}>{p.title}</Link>
                        ) : (
                          <span className="knowledge-muted">词条不可用</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {!c.collections.length && <p className="knowledge-muted">尚未收录词条</p>}
                </section>
                <section>
                  <h2>
                    <Route size={20} />
                    学习路线
                  </h2>
                  <KnowledgeStatus
                    loading={routes.loading}
                    error={routes.error}
                    retry={routes.reload}
                  />
                  {routes.data?.map((r) => (
                    <Link
                      className="knowledge-route-card"
                      key={r.id}
                      href={'/knowledge/routes/' + r.id}
                    >
                      <div>
                        <h3>{r.title}</h3>
                        <p>{r.goal}</p>
                      </div>
                    </Link>
                  ))}
                  {routes.data?.length === 0 && <p className="knowledge-muted">还没有学习路线。</p>}
                  <Link href="/knowledge">从全站知识库寻找更多内容</Link>
                </section>
              </div>
              {!cap.canContribute && <LoginNotice />}
            </>
          )}
        </>
      )}
    </div>
  );
}
function DirectoryNode({
  node,
  community,
}: {
  node: KnowledgeCommunity['nodes'][number];
  community: KnowledgeCommunity;
}) {
  return (
    <details className="knowledge-directory-node" open>
      <summary>{node.title}</summary>
      <ul>
        {community.entries
          .filter((e) => e.nodeId === node.id)
          .sort((a, b) => a.position - b.position)
          .map((e) => (
            <li key={e.pageId}>
              {e.available ? (
                <Link href={'/knowledge/' + e.pageId}>{e.title}</Link>
              ) : (
                <span>词条不可用</span>
              )}
            </li>
          ))}
      </ul>
      {community.nodes
        .filter((n) => n.parentId === node.id)
        .map((n) => (
          <DirectoryNode key={n.id} node={n} community={community} />
        ))}
    </details>
  );
}
