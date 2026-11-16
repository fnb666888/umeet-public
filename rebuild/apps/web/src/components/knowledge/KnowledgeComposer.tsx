'use client';
import { SiteLink as Link } from '../SiteLink';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type {
  KnowledgeContent,
  KnowledgePage,
  KnowledgeProposal,
  KnowledgeCapabilities,
} from '../../../../../packages/contracts/src/knowledge';
import { KnowledgeContentSchema } from '../../../../../packages/contracts/src/knowledge';
import { useKnowledge, useKnowledgeCapabilities } from './useKnowledge';
import { useKnowledgeDraft } from './useKnowledgeDraft';
import { knowledge, KnowledgeError, failureMessage } from './knowledge-client';
import { WikiEditor } from '../wiki/WikiEditor';
import { KnowledgeMarkdown } from './KnowledgeMarkdown';
import { RelationEditor } from './RelationEditor';
import { KnowledgeConflict } from './KnowledgeConflict';
import { KnowledgeHeader, KnowledgeStatus, LoginNotice } from './KnowledgeUI';
import { PagePicker } from './PagePicker';
import type { SavedDraft } from './useKnowledgeDraft';
import { RelationSnapshot } from './RelationSnapshot';
export const blankKnowledge: KnowledgeContent = {
  title: '',
  summary: '',
  markdown: '',
  template: 'plain',
  relations: [],
  baseRevisionId: null,
  changeNote: '',
};
const templates: Record<KnowledgeContent['template'], string> = {
  plain: '## 概述\n\n\n\n## 参考资料\n\n',
  handbook:
    '## 适用对象\n\n\n\n## 准备材料\n\n- \n\n## 办理步骤\n\n1. \n2. \n\n## 注意事项\n\n\n\n## 信息来源\n\n',
  academic:
    '## 概念\n\n\n\n## 假设与适用条件\n\n\n\n## 公式与推导\n\n$$\n\n$$\n\n## 示例\n\n\n\n## 参考资料\n\n',
};
export function KnowledgeComposer({ pageId }: { pageId?: string }) {
  const caps = useKnowledgeCapabilities(),
    params = useSearchParams();
  const page = useKnowledge<KnowledgePage>(pageId ? 'pages/' + pageId : 'capabilities');
  const proposalId = params.get('proposal');
  const proposals = useKnowledge<KnowledgeProposal>(
    proposalId ? 'proposals/' + encodeURIComponent(proposalId) : 'capabilities',
  );
  const proposal = proposalId ? proposals.data : null;
  const source = proposal?.content ?? (pageId ? page.data : blankKnowledge);
  const ready =
    !!caps.data && (!pageId || !!page.data || !!proposal) && (!proposalId || !!proposal);
  const initial: KnowledgeContent | null = source
    ? {
        title: source.title,
        summary: source.summary,
        markdown: source.markdown,
        template: source.template,
        relations: source.relations,
        baseRevisionId: proposal
          ? source.baseRevisionId
          : pageId
            ? (page.data?.revisionId ?? null)
            : null,
        changeNote: proposal ? source.changeNote : '',
      }
    : null;
  return (
    <div className="knowledge">
      <KnowledgeHeader
        title={pageId ? '完善词条' : '创建词条'}
        description="把一个独立概念或一项完整任务写清楚。"
      />
      <KnowledgeStatus
        loading={
          (!caps.data && caps.loading) ||
          (!!pageId && !proposal && page.loading) ||
          (!!proposalId && proposals.loading)
        }
        error={
          caps.error || (!proposal && pageId && page.error) || (proposalId && proposals.error) || ''
        }
        retry={() => {
          caps.reload();
          page.reload();
          proposals.reload();
        }}
      />
      {caps.data && !caps.cap.canContribute ? (
        <LoginNotice />
      ) : (
        ready &&
        initial && (
          <ComposerForm
            key={caps.cap.accountId + ':' + (pageId ?? 'new') + ':' + (proposalId ?? '')}
            accountId={caps.cap.accountId!}
            cap={caps.cap}
            initial={initial}
            pageId={pageId ?? null}
            paused={pageId ? (page.data?.paused ?? false) : false}
            task={params.get('task') ?? (proposalId ? 'proposal-' + proposalId : (pageId ?? 'new'))}
          />
        )
      )}
    </div>
  );
}
function ComposerForm({
  initial,
  pageId,
  paused,
  task,
  accountId,
  cap,
}: {
  initial: KnowledgeContent;
  pageId: string | null;
  paused: boolean;
  task: string;
  accountId: string;
  cap: KnowledgeCapabilities;
}) {
  const draft = useKnowledgeDraft({ accountId, editingTaskId: task, initial, pageId });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [preview, setPreview] = useState(false),
    [latest, setLatest] = useState<KnowledgePage | null>(null),
    [otherDraft, setOtherDraft] = useState<SavedDraft | null>(null),
    [done, setDone] = useState<{ pageId: string; published: boolean } | null>(null);
  const value = draft.content;
  function update(patch: Partial<KnowledgeContent>) {
    draft.setContent((c) => ({ ...c, ...patch }));
  }
  async function submit(forceProposal = false) {
    setError('');
    if (!KnowledgeContentSchema.safeParse(value).success) {
      setError('请填写词条标题和正文，并检查各字段长度。');
      return;
    }
    setBusy(true);
    try {
      await draft.flush();
      let id = draft.pageId;
      if (!id) {
        id = (await knowledge<{ id: string }>('pages', { method: 'POST', accountId, body: {} })).id;
        await draft.attachPage(id);
      }
      const published = cap.canGovernBody && !paused && !forceProposal;
      await knowledge('pages/' + id + (published ? '/publish' : '/submit'), {
        method: 'POST',
        accountId,
        body: { ...value, idempotencyKey: crypto.randomUUID() },
      });
      await draft.finish();
      setDone({ pageId: id, published });
    } catch (e) {
      setError(failureMessage(e));
      if (e instanceof KnowledgeError && e.code === 'REVISION_CONFLICT' && draft.pageId) {
        try {
          setLatest(await knowledge<KnowledgePage>('pages/' + draft.pageId));
        } catch (readError) {
          setError(failureMessage(readError));
        }
      }
    } finally {
      setBusy(false);
    }
  }
  if (!draft.loaded)
    return (
      <div className="knowledge-notice" role={draft.error ? 'alert' : 'status'}>
        {draft.error || '正在恢复私人草稿…'}
        {draft.error && <button onClick={() => location.reload()}>重新加载</button>}
      </div>
    );
  if (done)
    return (
      <section className="knowledge-empty">
        <h2>{done.published ? '词条已发布' : '修改已提交审核'}</h2>
        <p>
          {done.published
            ? '读者现在可以看到这个版本。'
            : '公开正文保持原样。审核结果和退回原因可在“我的贡献与管理”查看。'}
        </p>
        <div className="knowledge-actions">
          {done.published && (
            <Link className="knowledge-button knowledge-primary" href={'/knowledge/' + done.pageId}>
              查看词条
            </Link>
          )}
          <Link className="knowledge-button" href="/knowledge/manage">
            查看我的贡献
          </Link>
        </div>
      </section>
    );
  return (
    <>
      <div className="knowledge-editor-note">
        <span>私人草稿自动保存，仅自己可见</span>
        <span
          role="status"
          className={
            draft.state === 'failed' || draft.state === 'conflict' ? 'knowledge-danger' : ''
          }
        >
          {
            { saved: '已保存', saving: '保存中…', failed: '保存失败', conflict: '草稿版本冲突' }[
              draft.state
            ]
          }
        </span>
        {draft.state === 'failed' && (
          <button type="button" onClick={draft.retry}>
            重试保存
          </button>
        )}
      </div>
      {draft.error && (
        <div role="alert" className="knowledge-notice knowledge-error">
          {draft.error}
          {draft.state === 'conflict' && (
            <>
              <button
                type="button"
                onClick={async () => {
                  try {
                    setOtherDraft((await draft.compareServer()).draft);
                  } catch (e) {
                    setError(failureMessage(e));
                  }
                }}
              >
                对照另一设备的草稿
              </button>
              <button
                onClick={async () => {
                  try {
                    const newTask = await draft.fork();
                    location.assign(
                      (pageId ? '/knowledge/' + pageId + '/edit' : '/knowledge/new') +
                        '?task=' +
                        encodeURIComponent(newTask),
                    );
                  } catch (e) {
                    setError(failureMessage(e));
                  }
                }}
              >
                保留当前内容为独立草稿
              </button>
            </>
          )}
        </div>
      )}
      {otherDraft && (
        <section className="knowledge-conflict">
          <h2>比较私人草稿</h2>
          <div className="knowledge-compare">
            <div>
              <h3>当前设备</h3>
              <strong>{value.title}</strong>
              <pre>{value.markdown}</pre>
              <RelationSnapshot relations={value.relations} />
            </div>
            <div>
              <h3>另一设备已保存</h3>
              <strong>{otherDraft.content.title}</strong>
              <pre>{otherDraft.content.markdown}</pre>
              <RelationSnapshot relations={otherDraft.content.relations} />
            </div>
          </div>
          <p>可以继续整理当前内容并另存为独立草稿，两份内容都会保留。</p>
        </section>
      )}
      {paused && (
        <div className="knowledge-notice">此词条正在争议复核，当前修改将作为建议提交。</div>
      )}
      {latest && (
        <KnowledgeConflict
          mine={value}
          latest={latest}
          onConfirm={() => {
            update({ baseRevisionId: latest.revisionId });
            setLatest(null);
            setError('');
          }}
        />
      )}
      <form
        className="knowledge-form"
        data-account-draft-safe
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset className="knowledge-compose-fields" disabled={busy}>
          <section className="knowledge-form-section">
            <div className="knowledge-row">
              <label className="knowledge-grow">
                词条标题
                <input
                  aria-label="词条标题"
                  value={value.title}
                  onChange={(e) => update({ title: e.target.value })}
                  maxLength={160}
                  placeholder="例如：校园卡补办、几何光学"
                  required
                />
              </label>
              <label>
                内容模板
                <select
                  aria-label="内容模板"
                  value={value.template}
                  onChange={(e) =>
                    update({ template: e.target.value as KnowledgeContent['template'] })
                  }
                >
                  <option value="plain">普通词条</option>
                  <option value="handbook">指导手册</option>
                  <option value="academic">学科知识</option>
                </select>
              </label>
            </div>
            <label>
              摘要
              <input
                aria-label="词条摘要"
                value={value.summary}
                onChange={(e) => update({ summary: e.target.value })}
                maxLength={1000}
                placeholder="用一句话说明这篇词条解决什么问题"
              />
            </label>
          </section>
          <section className="knowledge-form-section">
            <div className="knowledge-row">
              <h2 className="knowledge-grow">正文</h2>
              <button
                className="knowledge-button"
                type="button"
                onClick={() => {
                  if (
                    !value.markdown.trim() ||
                    window.confirm('插入模板将替换当前正文，确定继续？')
                  )
                    update({ markdown: templates[value.template] });
                }}
              >
                插入模板
              </button>
              <button
                className="knowledge-button"
                type="button"
                aria-pressed={preview}
                onClick={() => setPreview((p) => !p)}
              >
                {preview ? '继续编辑' : '预览正文'}
              </button>
            </div>
            {preview ? (
              <KnowledgeMarkdown markdown={value.markdown} />
            ) : (
              <WikiEditor
                value={value.markdown}
                onChange={(markdown) => update({ markdown })}
                onUnsupported={setNotice}
              />
            )}
            <details>
              <summary>插入词条引用链接</summary>
              <PagePicker
                label="选择要引用的词条"
                onSelect={(p) => {
                  update({
                    markdown:
                      value.markdown +
                      '\n\n[' +
                      p.title.replace(/[\[\]]/g, '') +
                      '](/knowledge/' +
                      p.id +
                      ')\n',
                  });
                  setNotice('词条链接已添加到正文末尾，可调整到合适的位置。');
                }}
              />
            </details>
            <p className="knowledge-help">
              支持公式、表格、图片和 Markdown 链接。词条引用请使用词条页面的稳定链接。
            </p>
            {notice && <p role="status">{notice}</p>}
          </section>
          <RelationEditor
            value={value.relations}
            onChange={(relations) => update({ relations })}
            {...(pageId ? { pageId } : {})}
          />
          <section className="knowledge-form-section">
            <label>
              修改说明
              <textarea
                aria-label="修改说明"
                rows={2}
                value={value.changeNote}
                onChange={(e) => update({ changeNote: e.target.value })}
                maxLength={2000}
                placeholder="说明补充或纠正了什么，便于审核"
              />
            </label>
          </section>
          {error && (
            <p role="alert" className="knowledge-notice knowledge-error">
              {error}
            </p>
          )}
          <footer className="knowledge-editor-footer">
            <span>
              {cap.canGovernBody && !paused
                ? '发布后立即更新公开正文并保留历史。'
                : '提交后先审核，通过后更新公开正文。'}
            </span>
            <div className="knowledge-actions">
              <button
                type="button"
                className="knowledge-button"
                disabled={busy}
                onClick={() => {
                  void draft
                    .flush()
                    .then(() => setNotice('私人草稿已保存'))
                    .catch((e) => setError(failureMessage(e)));
                }}
              >
                保存草稿
              </button>
              <button
                className="knowledge-button knowledge-primary"
                disabled={busy || !!latest || draft.state === 'conflict'}
              >
                {busy ? '正在提交…' : cap.canGovernBody && !paused ? '发布词条' : '提交审核'}
              </button>
            </div>
          </footer>
        </fieldset>
      </form>
    </>
  );
}
