'use client';
import { useState } from 'react';
import type {
  KnowledgeCommunity,
  KnowledgeDirectoryChange,
  KnowledgeCapabilities,
} from '../../../../../packages/contracts/src/knowledge';
import { PagePicker } from './PagePicker';
import { knowledge, failureMessage } from './knowledge-client';
export function DirectoryEditor({
  community,
  cap,
  onSaved,
  onCancel,
}: {
  community: KnowledgeCommunity;
  cap: KnowledgeCapabilities;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<KnowledgeDirectoryChange>({
      expectedVersion: community.version,
      nodes: community.nodes,
      entries: community.entries.map(({ nodeId, pageId, position }) => ({
        nodeId,
        pageId,
        position,
      })),
      collections: community.collections.map((c) => c.pageId),
    }),
    [titles, setTitles] = useState<Record<string, string>>(
      Object.fromEntries(community.collections.map((c) => [c.pageId, c.title])),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  function update(patch: Partial<KnowledgeDirectoryChange>) {
    setValue((v) => ({ ...v, ...patch }));
  }
  function move(index: number, delta: number) {
    const nodes = [...value.nodes],
      target = index + delta;
    if (target < 0 || target >= nodes.length) return;
    [nodes[index], nodes[target]] = [nodes[target]!, nodes[index]!];
    update({ nodes: nodes.map((n, position) => ({ ...n, position })) });
  }
  return (
    <form
      className="knowledge-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await knowledge(
            'communities/' +
              community.id +
              (cap.canOrganizeCommunity ? '/directory' : '/suggestions'),
            {
              method: cap.canOrganizeCommunity ? 'PUT' : 'POST',
              accountId: cap.accountId!,
              body: cap.canOrganizeCommunity ? value : { kind: 'directory', change: value },
            },
          );
          onSaved();
        } catch (e) {
          setError(failureMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="knowledge-compose-fields" disabled={busy}>
        <section className="knowledge-form-section">
          <div className="knowledge-row">
            <h2 className="knowledge-grow">
              {cap.canOrganizeCommunity ? '维护社区目录' : '建议调整目录'}
            </h2>
            <button
              type="button"
              className="knowledge-button"
              onClick={() =>
                update({
                  nodes: [
                    ...value.nodes,
                    {
                      id: crypto.randomUUID(),
                      title: '新目录',
                      parentId: null,
                      position: value.nodes.length,
                    },
                  ],
                })
              }
            >
              添加目录
            </button>
          </div>
          <p className="knowledge-help">
            目录可分层；同一篇词条可以在多个目录出现。上下移动按钮也可用键盘操作。
          </p>
          {value.nodes.map((node, i) => (
            <div className="knowledge-directory-edit" key={node.id}>
              <div className="knowledge-row">
                <label className="knowledge-grow">
                  目录名称
                  <input
                    value={node.title}
                    required
                    maxLength={120}
                    onChange={(e) =>
                      update({
                        nodes: value.nodes.map((n) =>
                          n.id === node.id ? { ...n, title: e.target.value } : n,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  上级目录
                  <select
                    value={node.parentId ?? ''}
                    onChange={(e) =>
                      update({
                        nodes: value.nodes.map((n) =>
                          n.id === node.id ? { ...n, parentId: e.target.value || null } : n,
                        ),
                      })
                    }
                  >
                    <option value="">顶层目录</option>
                    {value.nodes
                      .filter((n) => n.id !== node.id)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.title}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  aria-label={'上移目录 ' + node.title}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  上移
                </button>
                <button
                  type="button"
                  aria-label={'下移目录 ' + node.title}
                  disabled={i === value.nodes.length - 1}
                  onClick={() => move(i, 1)}
                >
                  下移
                </button>
                <button
                  type="button"
                  className="knowledge-danger"
                  onClick={() => {
                    const children = value.nodes.filter((n) => n.parentId === node.id);
                    if (
                      !window.confirm(
                        '删除此目录将移除本目录中的词条挂载，直接下级目录会移到顶层。共享正文会保留。',
                      )
                    )
                      return;
                    update({
                      nodes: value.nodes
                        .filter((n) => n.id !== node.id)
                        .map((n) =>
                          children.some((c) => c.id === n.id) ? { ...n, parentId: null } : n,
                        ),
                      entries: value.entries.filter((e) => e.nodeId !== node.id),
                    });
                  }}
                >
                  删除目录
                </button>
              </div>
              <div className="knowledge-directory-choices">
                {value.collections.map((pageId) => (
                  <label key={pageId}>
                    <input
                      type="checkbox"
                      checked={value.entries.some(
                        (e) => e.nodeId === node.id && e.pageId === pageId,
                      )}
                      onChange={(e) =>
                        update({
                          entries: e.target.checked
                            ? [
                                ...value.entries,
                                {
                                  nodeId: node.id,
                                  pageId,
                                  position: value.entries.filter((x) => x.nodeId === node.id)
                                    .length,
                                },
                              ]
                            : value.entries.filter(
                                (x) => !(x.nodeId === node.id && x.pageId === pageId),
                              ),
                        })
                      }
                    />
                    {titles[pageId] ?? '已收录词条'}
                  </label>
                ))}
              </div>
              <div className="knowledge-sort-list">
                {value.entries
                  .filter((e) => e.nodeId === node.id)
                  .sort((a, b) => a.position - b.position)
                  .map((entry, index, entries) => (
                    <div key={entry.pageId}>
                      <span>{titles[entry.pageId]}</span>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => {
                          const order = entries.map((e) => e.pageId);
                          [order[index - 1], order[index]] = [order[index]!, order[index - 1]!];
                          update({
                            entries: value.entries.map((e) =>
                              e.nodeId === node.id
                                ? { ...e, position: order.indexOf(e.pageId) }
                                : e,
                            ),
                          });
                        }}
                      >
                        前移词条
                      </button>
                      <button
                        type="button"
                        disabled={index === entries.length - 1}
                        onClick={() => {
                          const order = entries.map((e) => e.pageId);
                          [order[index], order[index + 1]] = [order[index + 1]!, order[index]!];
                          update({
                            entries: value.entries.map((e) =>
                              e.nodeId === node.id
                                ? { ...e, position: order.indexOf(e.pageId) }
                                : e,
                            ),
                          });
                        }}
                      >
                        后移词条
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </section>
        <section className="knowledge-form-section">
          <h2>社区收录</h2>
          <PagePicker
            label="从全站知识库收录词条"
            exclude={value.collections}
            onSelect={(p) => {
              update({ collections: [...value.collections, p.id] });
              setTitles((t) => ({ ...t, [p.id]: p.title }));
            }}
          />
          {value.collections.map((id) => (
            <div className="knowledge-row" key={id}>
              <span className="knowledge-grow">{titles[id]}</span>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('取消收录会移除本社区目录中的引用，共享正文仍会保留。继续？'))
                    update({
                      collections: value.collections.filter((p) => p !== id),
                      entries: value.entries.filter((e) => e.pageId !== id),
                    });
                }}
              >
                取消收录
              </button>
            </div>
          ))}
        </section>
        {error && (
          <p className="knowledge-notice knowledge-error" role="alert">
            {error}
          </p>
        )}
        <div className="knowledge-actions">
          <button
            className="knowledge-button"
            type="button"
            onClick={() => {
              if (window.confirm('确定取消这些尚未提交的目录调整？')) onCancel();
            }}
          >
            取消调整
          </button>
          <button className="knowledge-button knowledge-primary" disabled={busy}>
            {busy ? '正在保存…' : cap.canOrganizeCommunity ? '保存社区目录' : '提交目录建议'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
