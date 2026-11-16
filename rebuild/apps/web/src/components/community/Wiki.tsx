'use client';
import { navigateCommunity } from '../../lib/community-route';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useCommunity } from './store';
import { Icon } from './Icon';
import { WikiText } from './content';
import { ReportButton } from './Governance';
import { boards, postHref, wikiDate, type Board, type Wiki, type WikiVersion } from './model';

export function Modal({
  title,
  children,
  close,
  className = '',
}: {
  className?: string;
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      id="wiki-dialog"
      className={'wiki-dialog ' + className}
      aria-labelledby="wiki-dialog-title"
      onCancel={close}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <header>
        <h2 id="wiki-dialog-title">{title}</h2>
        <button type="button" className="icon-btn" aria-label="关闭窗口" onClick={close}>
          <Icon name="x" />
        </button>
      </header>
      <div className="wiki-dialog-content">{children}</div>
    </dialog>
  );
}
export function WikiIndex({ board = '' }: { board?: string }) {
  const { data, requireLogin } = useCommunity();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const entries = data!.content.wiki
    .filter(
      (wiki) =>
        (!board || wiki.communities.includes(board as Board)) &&
        [
          wiki.title,
          wiki.summary,
          wiki.kind,
          wiki.scope,
          ...wiki.sections.map((section) => section.h + ' ' + section.p),
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return (
    <div className={'wiki-directory ' + (board ? 'wiki-board-directory' : '')}>
      <div className="page-head wiki-head">
        <div>
          {board ? <h2>板块 Wiki</h2> : <h1>Wiki</h1>}
          <p>把同学们的经验，整理成随时可查的指南。</p>
        </div>
        <button
          className="wiki-soft-button"
          data-wiki-create={board}
          onClick={() => {
            if (requireLogin()) setEditing(true);
          }}
        >
          <Icon name="plus" /> 新建词条
        </button>
      </div>
      <div className="search wiki-search">
        <Icon name="search" />
        <input
          id="wiki-q"
          type="search"
          aria-label={board ? '搜索板块 Wiki' : '搜索词条'}
          placeholder="搜校园卡、选课、图书馆…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="wiki-list-heading">
        <h2>{board ? '本板块词条' : '全部词条'}</h2>
        <span id="wiki-result-count" role="status">
          {entries.length} 篇
        </span>
      </div>
      <div id="wiki-results">
        {entries.length ? (
          entries.map((wiki) => (
            <a key={wiki.id} className="wiki-entry" href={'#/wiki/' + wiki.id}>
              <div className="wiki-entry-main">
                <h3>{wiki.title}</h3>
                <p>{wiki.summary}</p>
                <span className="wiki-entry-kind">{wiki.kind || '校园指南'}</span>
              </div>
              <time dateTime={wiki.updatedAt}>{wikiDate(wiki)}更新</time>
            </a>
          ))
        ) : (
          <div className="wiki-no-results">
            <p>没有找到相关词条</p>
            <span>试试“校园卡”“自习”或“选课”，也可以新建一篇。</span>
          </div>
        )}
      </div>
      <div className="wiki-directory-foot">
        <span>发现内容过时？打开词条即可补充或纠错。</span>
        {board ? <a href="#/wiki">查看全部词条</a> : <span>由社区共同维护</span>}
      </div>
      {editing && <WikiEditor board={board} close={() => setEditing(false)} />}
    </div>
  );
}
function Reference({ value }: { value: string }) {
  return /^https?:\/\/[^\s]+$/i.test(value) ? (
    <a href={value} target="_blank" rel="noopener noreferrer">
      {value}
    </a>
  ) : (
    <>{value}</>
  );
}
function Revision({ value }: { value: WikiVersion }) {
  return (
    <>
      <b>{value.title}</b>
      <p>{value.summary}</p>
      {value.quick?.map((row, index) => (
        <p key={index}>{row.join('：')}</p>
      ))}
      {value.sections?.map((section, index) => (
        <div key={index}>
          <h4>{section.h}</h4>
          <p>{section.p}</p>
        </div>
      ))}
      {value.table?.rows.map((row, index) => (
        <p key={index}>{row.join(' / ')}</p>
      ))}
      {value.reference && <p>来源：{value.reference}</p>}
    </>
  );
}
const sectionId = (wiki: Wiki, index: number) => 'ws-' + (wiki.sections[index].id || index);
export function WikiArticle({ id, anchor }: { id: string; anchor: string }) {
  const { data, busy, mutate, requireLogin } = useCommunity();
  const wiki = data!.content.wiki.find((wiki) => wiki.id === id || wiki.previousTitles?.includes(id));
  const [dialog, setDialog] = useState('');
  const [note, setNote] = useState('');
  const [active, setActive] = useState(anchor);
  const toc = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (toc.current) toc.current.open = !matchMedia('(max-width:1000px)').matches;
  }, [id]);
  useEffect(() => {
    if (!wiki) return;
    const headings = document.querySelectorAll('.wiki-reading-body h2[id]');
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        }),
      { rootMargin: '-15% 0px -65% 0px' },
    );
    headings.forEach((node) => observer.observe(node));
    if (anchor)
      requestAnimationFrame(() => {
        document.getElementById(anchor)?.scrollIntoView();
        document.getElementById(anchor)?.focus({ preventScroll: true });
      });
    return () => observer.disconnect();
  }, [id, anchor, wiki]);
  if (!wiki)
    return (
      <div className="empty">
        词条不存在。<a href="#/wiki">查看全部词条</a>
      </div>
    );
  const sources = data!.content.posts.filter((post) => post.wikiRef?.id === id);
  const links = [
    ...wiki.sections.map((section, index) => [sectionId(wiki, index), section.h]),
    ['ws-sources', '资料与来源'],
    ['ws-contribute', '补充与讨论'],
  ];
  const open = (action: string) => {
    if (action === 'history' || requireLogin()) setDialog(action);
  };
  return (
    <div className="wiki-article-wrap">
      <div className="crumb">
        <a href="#/wiki">Wiki</a>
        <span>/</span>
        <span>{wiki.kind || '校园指南'}</span>
      </div>
      <header className="wiki-article-head">
        <h1>{wiki.title}</h1>
        {wiki.quality && wiki.quality !== 'none' && <p className="wiki-protection-note">{{ sources: '该词条需要补充可靠来源', outdated: '该词条部分信息可能已过时', disputed: '该词条内容存在争议' }[wiki.quality]}</p>}
        {(!wiki.protectionUntil || new Date(wiki.protectionUntil) > new Date()) && (wiki.protected || (wiki.protection && wiki.protection !== 'open')) && <p className="wiki-protection-note">{wiki.protection === 'trusted' ? '该词条限注册满 7 天且无有效处罚的用户编辑。' : '该词条由社区管理人员编辑。'}你仍可提交补充与纠错建议。{wiki.protectionUntil && '保护至 ' + new Date(wiki.protectionUntil).toLocaleString('zh-CN')}</p>}
        <p>{wiki.summary}</p>
        <div className="wiki-article-meta">
          <span>{wiki.scope || '校园社区'}</span>
          <span>{wikiDate(wiki)}更新</span>
          <span>{wiki.editor}维护</span>
        </div>
        <div className="wiki-article-tools">
          <ReportButton target={'wiki:' + wiki.id} label="举报词条" boards={wiki.communities} />
          <button
            className="wiki-soft-button"
            data-wiki-action="suggest"
            onClick={() => open('suggest')}
          >
            <Icon name="pencil" /> 补充 / 纠错
          </button>
          <button className="wiki-text-button" data-wiki-action="edit" onClick={() => open('edit')}>
            编辑词条
          </button>
          <button
            className="wiki-text-button"
            data-wiki-action="history"
            onClick={() => open('history')}
          >
            修订记录
          </button>
        </div>
      </header>
      <div className="wiki-reading-layout">
        <aside className="wiki-reading-side">
          <details className="wiki-reading-toc" ref={toc} open>
            <summary>
              本文目录 <Icon name="list" />
            </summary>
            <nav className="toc" aria-label="词条目录">
              {links.map(([section, title]) => (
                <a
                  key={section}
                  href={'#/wiki/' + id + '#' + section}
                  className={active === section ? 'cur' : ''}
                  aria-current={active === section ? 'location' : undefined}
                  onClick={() => {
                    document.getElementById(section)?.scrollIntoView();
                    if (toc.current && matchMedia('(max-width:1000px)').matches)
                      toc.current.open = false;
                  }}
                >
                  {title}
                </a>
              ))}
            </nav>
          </details>
          <p className="wiki-side-note">
            <Icon name="users" /> 每一份补充，都会让下一位同学少走弯路。
          </p>
        </aside>
        <article className="wiki-reading-body">
          {wiki.example && (
            <div className="wiki-example-note">
              示例内容 · 校园规则与地点尚未核实，请以学校现行公告为准。
            </div>
          )}
          {wiki.quick.length > 0 && (
            <section className="wiki-quick">
              <h2>快速查阅</h2>
              <dl>
                {wiki.quick.map(([key, value], index) => (
                  <div key={index}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {wiki.sections.map((section, index) => (
            <section className="wiki-content-section" key={section.id || index}>
              <h2 id={sectionId(wiki, index)} tabIndex={-1}>
                {section.h}
              </h2>
              <WikiText text={section.p} wiki={data!.content.wiki} />
            </section>
          ))}
          {wiki.table && (
            <div className="wiki-table-wrap" role="region" aria-label="对照表" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    {wiki.table.heads.map((head, index) => (
                      <th key={index} scope="col">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {wiki.table.rows.map((row, index) => (
                    <tr key={index}>
                      {row.map((cell, column) => (
                        <td key={column}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <section className="wiki-content-section">
            <h2 id="ws-sources" tabIndex={-1}>
              资料与来源
            </h2>
            <p className="wiki-source-note">社区共同整理；办事规则请对照学校当前公告。</p>
            {wiki.reference && (
              <p>
                补充来源：
                <Reference value={wiki.reference} />
              </p>
            )}
            {sources.length > 0 && (
              <>
                <h3>相关讨论</h3>
                <ul className="wiki-source-list">
                  {sources.map((post) => (
                    <li key={post.id}>
                      <a
                        href={
                          postHref(post) +
                          (post.wikiRef?.answerId ? '#cm-' + post.wikiRef.answerId : '')
                        }
                      >
                        {post.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <section className="wiki-contribute">
            <h2 id="ws-contribute" tabIndex={-1}>
              一起完善这篇指南
            </h2>
            <p>信息变了，或有更好的办法？补充你知道的内容。</p>
            <button className="wiki-soft-button" onClick={() => open('suggest')}>
              <Icon name="plus" /> 补充 / 纠错
            </button>
            {wiki.suggestions.length > 0 && (
              <div className="wiki-suggestions">
                <h3>我的补充</h3>
                {wiki.suggestions.map((suggestion) => (
                  <div className="wiki-suggestion" key={suggestion.id}>
                    <div>
                      <b>{suggestion.section}</b>
                      <span>{suggestion.applied ? '已整理入正文' : '已记录，待整理'}</span>
                    </div>
                    <p>{suggestion.text}</p>
                    <small>
                      {suggestion.author} · {new Date(suggestion.at).toLocaleDateString('zh-CN')}
                      {suggestion.reference && (
                        <>
                          {' '}
                          · 来源：
                          <Reference value={suggestion.reference} />
                        </>
                      )}
                    </small>
                  </div>
                ))}
              </div>
            )}
            <details className="wiki-discussion">
              <summary>词条讨论（{wiki.notes.length}）</summary>
              <div>
                {wiki.notes.length ? (
                  wiki.notes.map((note, index) => (
                    <div className="wiki-note" key={note.id || index}>
                      <b>{note.author}</b>
                      <p>{note.text}</p>
                    </div>
                  ))
                ) : (
                  <p className="muted">还没有讨论，可以先提出一个问题。</p>
                )}
              </div>
              <form
                id="wiki-note-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (
                    note.trim() &&
                    (await mutate(
                      [{ type: 'wiki.note', wikiId: id, text: note.trim() }],
                      '讨论已保存',
                    ))
                  )
                    setNote('');
                }}
              >
                <label className="sr-only" htmlFor="wiki-note">
                  讨论内容
                </label>
                <textarea
                  id="wiki-note"
                  required
                  maxLength={2000}
                  placeholder="针对这篇指南提问或分享经验…"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
                <button type="submit" className="wiki-soft-button" disabled={busy}>
                  发表讨论
                </button>
              </form>
            </details>
          </section>
        </article>
      </div>
      {dialog === 'edit' && <WikiEditor wiki={wiki} close={() => setDialog('')} />}
      {dialog === 'suggest' && <Suggestion wiki={wiki} close={() => setDialog('')} />}
      {dialog === 'history' && (
        <Modal title="修订记录" close={() => setDialog('')}>
          <p className="muted">{wiki.title}</p>
          {wiki.history.length ? (
            wiki.history.map((revision, index) => (
              <details className="wiki-revision" key={index}>
                <summary>
                  <b>{revision.reason}</b>
                  <span>
                    {revision.author} · {new Date(revision.at).toLocaleString('zh-CN')}
                  </span>
                </summary>
                <div className="wiki-diff">
                  {!revision.hidden && <ReportButton target={'wiki:' + wiki.id + ':' + (wiki.revisions - index)} label="举报此修订" boards={wiki.communities} />}
                  <div>
                    <h3>修改前</h3>
                    <Revision value={revision.before} />
                  </div>
                  <div>
                    <h3>修改后</h3>
                    <Revision value={revision.after} />
                  </div>
                </div>
              </details>
            ))
          ) : (
            <p>暂时没有修订记录。保存一次修改后，可以在这里比较前后内容。</p>
          )}
          <p className="wiki-form-hint">这里显示社区中已保存的修订。</p>
        </Modal>
      )}
    </div>
  );
}
function Suggestion({ wiki, close }: { wiki: Wiki; close: () => void }) {
  const { busy, mutate } = useCommunity();
  const [index, setIndex] = useState(0);
  const [text, setText] = useState('');
  const [reference, setReference] = useState('');
  return (
    <Modal title="补充 / 纠错" close={close}>
      <p className="muted">{wiki.title}</p>
      <form
        id="wiki-suggest-form"
        className="wiki-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            text.trim() &&
            (await mutate(
              [
                {
                  type: 'wiki.suggest',
                  id: 's' + crypto.randomUUID(),
                  wikiId: wiki.id,
                  index,
                  text: text.trim(),
                  reference,
                },
              ],
              '补充已记录，可在词条底部查看',
            ))
          )
            close();
        }}
      >
        <label>
          对应章节
          <select
            id="wiki-suggest-section"
            value={index}
            onChange={(event) => setIndex(Number(event.target.value))}
          >
            {wiki.sections.map((section, index) => (
              <option key={index} value={index}>
                {section.h}
              </option>
            ))}
          </select>
        </label>
        <label>
          你想补充或修正什么？
          <textarea
            id="wiki-suggest-text"
            required
            maxLength={4000}
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="写清楚变更内容，方便其他同学核对。"
          />
        </label>
        <label>
          资料来源（选填）
          <input
            id="wiki-suggest-reference"
            maxLength={1000}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        </label>
        <p className="wiki-form-hint">提交后保存到社区。你可以继续编辑正文，将补充整理进指南。</p>
        <button type="submit" className="wiki-soft-button" disabled={busy}>
          提交补充
        </button>
      </form>
    </Modal>
  );
}
export function WikiEditor({
  wiki,
  board = '',
  close,
}: {
  wiki?: Wiki;
  board?: string;
  close: () => void;
}) {
  const { busy, mutate } = useCommunity();
  const [title, setTitle] = useState(wiki?.title || '');
  const [summary, setSummary] = useState(wiki?.summary || '');
  const [selected, setSelected] = useState(board);
  const [sections, setSections] = useState(wiki?.sections || [{ h: '开始之前', p: '' }]);
  const [quick, setQuick] = useState(wiki?.quick.map((row) => row.join(' | ')).join('\n') || '');
  const [table, setTable] = useState(
    wiki?.table?.rows.map((row) => row.join(' | ')).join('\n') || '',
  );
  const [reference, setReference] = useState(wiki?.reference || '');
  const [reason, setReason] = useState(wiki ? '' : '创建词条');
  const [applied, setApplied] = useState<string[]>([]);
  const [error, setError] = useState('');
  const revision = useRef(wiki?.revisions || 0);
  const newId = useRef('');
  function changeSection(index: number, key: 'h' | 'p', value: string) {
    setSections(
      sections.map((section, position) =>
        position === index ? { ...section, [key]: value } : section,
      ),
    );
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parseRows = (value: string) =>
      value
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => line.split('|').map((cell) => cell.trim()));
    const rows = parseRows(quick);
    const tableRows = parseRows(table);
    if (
      !title.trim() ||
      !summary.trim() ||
      !reason.trim() ||
      sections.some((section) => !section.h.trim() || !section.p.trim())
    )
      return setError('请填写标题、简介、章节内容和修改说明。');
    if (
      rows.some((row) => row.length !== 2 || row.some((cell) => !cell)) ||
      (wiki?.table &&
        tableRows.some(
          (row) => row.length !== wiki.table!.heads.length || row.some((cell) => !cell),
        ))
    )
      return setError('请核对速查和对照表的栏数，用 | 分隔。');
    if (!newId.current) newId.current = 'w' + crypto.randomUUID();
    const id = wiki?.id || newId.current;
    if (
      await mutate(
        [
          {
            type: 'wiki.save',
            wiki: {
              id,
              title: title.trim(),
              summary: summary.trim(),
              communities: wiki?.communities || (selected ? [selected as Board] : []),
              sections: sections.map((section) => ({
                ...section,
                h: section.h.trim(),
                p: section.p.trim(),
              })),
              quick: rows as [string, string][],
              reference,
              table: wiki?.table ? { ...wiki.table, rows: tableRows } : null,
            },
            baseRevision: revision.current,
            reason: reason.trim(),
            applied,
          },
        ],
        '修改已保存',
      )
    ) {
      close();
      navigateCommunity('#/wiki/' + id);
    }
  }
  return (
    <Modal title={wiki ? '编辑词条' : '新建词条'} close={close}>
      <form id="wiki-editor" className="wiki-form" onSubmit={save}>
        <label>
          词条标题
          <input
            id="we-title"
            required
            maxLength={80}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="用具体问题或事项命名"
          />
        </label>
        <label>
          一句话简介
          <input
            id="we-summary"
            required
            maxLength={180}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="这篇指南能帮同学解决什么问题？"
          />
        </label>
        {!wiki && (
          <label>
            关联板块
            <select
              id="we-board"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Wiki</option>
              {boards.map((board) => (
                <option key={board.slug} value={board.slug}>
                  {board.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <details className="wiki-structured-editor">
          <summary>快速查阅{wiki?.table ? '与楼层对照' : ''}</summary>
          <label>
            快速查阅（每行：事项 | 说明）
            <textarea
              id="we-quick"
              rows={4}
              value={quick}
              onChange={(event) => setQuick(event.target.value)}
            />
          </label>
          {wiki?.table && (
            <label>
              楼层对照（每行用 | 分隔）
              <textarea
                id="we-table"
                rows={5}
                value={table}
                onChange={(event) => setTable(event.target.value)}
              />
            </label>
          )}
        </details>
        <div id="we-sections">
          {sections.map((section, index) => (
            <fieldset key={index} data-we-section={index}>
              <legend>章节 {index + 1}</legend>
              <label>
                章节标题
                <input
                  className="we-heading"
                  required
                  maxLength={80}
                  value={section.h}
                  onChange={(event) => changeSection(index, 'h', event.target.value)}
                />
              </label>
              <label>
                内容
                <textarea
                  className="we-body"
                  required
                  rows={4}
                  maxLength={10000}
                  value={section.p}
                  onChange={(event) => changeSection(index, 'p', event.target.value)}
                />
              </label>
            </fieldset>
          ))}
        </div>
        <button
          type="button"
          className="wiki-text-button"
          id="we-add"
          disabled={sections.length >= 30}
          onClick={() => setSections([...sections, { h: '', p: '' }])}
        >
          <Icon name="plus" /> 添加章节
        </button>
        {wiki?.suggestions.some((suggestion) => !suggestion.applied) && (
          <details className="wiki-editor-suggestions">
            <summary>
              待整理的补充（{wiki.suggestions.filter((suggestion) => !suggestion.applied).length}）
            </summary>
            {wiki.suggestions
              .filter((suggestion) => !suggestion.applied)
              .map((suggestion) => (
                <div key={suggestion.id}>
                  <p>
                    <b>{suggestion.section}</b>：{suggestion.text}
                  </p>
                  <label className="wiki-checkbox">
                    <input
                      type="checkbox"
                      name="wiki-apply"
                      value={suggestion.id}
                      checked={applied.includes(suggestion.id)}
                      onChange={(event) =>
                        setApplied(
                          event.target.checked
                            ? [...applied, suggestion.id]
                            : applied.filter((id) => id !== suggestion.id),
                        )
                      }
                    />
                    本次已整理入正文
                  </label>
                </div>
              ))}
          </details>
        )}
        <label>
          资料来源（选填）
          <input
            id="we-reference"
            maxLength={1000}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        </label>
        <label>
          修改说明
          <input
            id="we-reason"
            required
            maxLength={160}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：补充四楼插座位置"
          />
        </label>
        <p className="wiki-form-hint">内容与修订记录保存到社区。</p>
        {error && (
          <p id="we-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="wiki-soft-button" disabled={busy}>
          {wiki ? '保存修改' : '创建词条'}
        </button>
      </form>
    </Modal>
  );
}
