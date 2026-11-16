'use client';
import { navigateCommunity } from '../../lib/community-route';
import { isContentBoard } from '../../../../../packages/contracts/src/interest';
import { useEffect, useRef, useState } from 'react';
import { useCommunity } from './store';
import { Icon } from './Icon';
import { boardGuides, boards, cleanHtml, plainText, readImage, type Board } from './model';
import { PostEditor, type PostEditorHandle } from './PostEditor';
import { ToolbarPopover } from './ToolbarPopover';
import { postTags } from './postTags';

type Draft = {
  community: Board;
  title: string;
  html: string;
  md: string;
  mode: 'rich' | 'md';
  price: string;
  meeting: string;
  meetingTime: string;
  tags: string[];
  images: string[];
  projectEnabled: boolean;
  project: { work: string; access: string; feedback: string };
};
const emptyDraft = (community: Board): Draft => ({
  community,
  title: '',
  html: '',
  md: '',
  mode: 'md',
  price: '',
  meeting: '',
  meetingTime: '',
  tags: [],
  images: [],
  projectEnabled: false,
  project: { work: '', access: '', feedback: '' },
});
const emojis = [
  '😀',
  '😂',
  '🥹',
  '😍',
  '🤔',
  '😭',
  '😅',
  '🙃',
  '😴',
  '🤗',
  '🤝',
  '👍',
  '👎',
  '🙏',
  '👏',
  '💪',
  '🔥',
  '✨',
  '🎉',
  '❤️',
  '🧡',
  '💚',
  '🍀',
  '🌱',
  '📚',
  '✏️',
  '🎒',
  '☕',
  '🍜',
  '🏀',
  '⚽',
  '🚲',
  '🌧️',
  '☀️',
  '🌙',
  '⭐',
  '📷',
  '🎧',
  '💡',
  '📌',
];
export function MarketRules() {
  return (
    <article className="card wiki-prose">
      <h2>校园二手交易规则</h2>
      <p>
        发帖时写清价格、物品成色和已知问题。请通过私信约定面交地点，避免在公开帖里留下联系方式。
      </p>
      <p>建议约在校园公共区域，验货后再付款。交易结束后由卖家标记「已出」，原帖可继续查阅。</p>
    </article>
  );
}
export function Composer() {
  const { data, siteSettings, composer, closeComposer, busy, mutate, toast } = useCommunity();
  const dialog = useRef<HTMLDialogElement>(null);
  const editor = useRef<PostEditorHandle>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [editorInitial, setEditorInitial] = useState<Draft | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const draftRef = useRef<Draft>(emptyDraft('questions'));
  const [draft, setDraft] = useState(draftRef.current);
  const emojiButton = useRef<HTMLButtonElement>(null);
  const tagButton = useRef<HTMLButtonElement>(null);
  const [emoji, setEmoji] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [rules, setRules] = useState(false);
  const [error, setError] = useState('');
  const [invalidField, setInvalidField] = useState<'title' | 'body' | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const key = 'umeet-composer-' + (data?.actor?.userId || 'guest');
  useEffect(() => {
    const save = (event: Event) => {
      if (!composer) return;
      try { localStorage.setItem(key, JSON.stringify(draftRef.current)); }
      catch { event.preventDefault(); toast('草稿保存失败，请保留页面，暂时无法切换账号'); }
      if (busy) event.preventDefault();
    };
    window.addEventListener('umeet:before-account-change', save);
    return () => window.removeEventListener('umeet:before-account-change', save);
  }, [composer, key, busy, toast]);
  const set = (value: Partial<Draft>) => {
    const next = { ...draftRef.current, ...value };
    draftRef.current = next;
    setDraft(next);
    if ((value.title !== undefined && invalidField === 'title') || (value.md !== undefined && invalidField === 'body')) { setInvalidField(null); setError(''); }
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      toast('浏览器未能保存草稿，请保留当前页面');
    }
  };
  useEffect(() => {
    if (!composer) {
      dialog.current?.close();
      setEditorInitial(null);
      return;
    }
    let next = emptyDraft(composer);
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (
        saved &&
        (saved.title ||
          saved.html ||
          saved.md ||
          saved.images?.length ||
          saved.price ||
          saved.meeting ||
          saved.meetingTime ||
          saved.tags?.length ||
          Object.values(saved.project || {}).some(Boolean))
      )
        next = { ...next, ...saved };
      else {
        const previous = JSON.parse(
          localStorage.getItem('umeet-drafts-' + data?.actor?.userId) || '{}',
        ).composerDraft;
        if (previous)
          next = {
            ...next,
            ...previous,
            images: previous.images || [],
            project: { ...next.project, ...previous.project },
          };
      }
    } catch {
      toast('发帖草稿未能恢复');
    }
    draftRef.current = next;
    setDraft(next);
    setError('');
    setEmoji(false);
    setInvalidField(null);
    setTagsOpen(false);
    dialog.current?.showModal();
    setEditorInitial(next);
  }, [composer, key, data?.actor?.userId, toast]);
  const toggleTag = (value: string) => {
    const selected = draftRef.current.tags;
    if (!postTags.some((tag) => tag === value)) return;
    if (selected.includes(value)) set({ tags: selected.filter((tag) => tag !== value) });
    else if (selected.length < 3) set({ tags: [...selected, value] });
    setError('');
  };
  const publish = async () => {
    if (busy || !editorReady) return;
    const html = cleanHtml(draftRef.current.html);
    const body = plainText(html);
    const title = draft.title.trim();
    if (draft.community !== 'daily' && !title) {
      setError('请填写标题');
      setInvalidField('title');
      titleInput.current?.focus();
      return;
    }
    if (
      body.length > 2000 ||
      (!body &&
        !draft.images.length &&
        !(draft.projectEnabled && Object.values(draft.project).some((value) => value.trim())))
    ) {
      setError(body.length > 2000 ? '正文最多 2000 字' : '请填写正文或添加图片');
      setInvalidField('body');
      editor.current?.focus();
      return;
    }
    const id = 'p' + crypto.randomUUID();
    const meetingAt = Date.parse(draft.meetingTime);
    let pendingReview = false;
    const saved = await mutate(
      [
        {
          type: 'post.create',
          post: {
            id,
            community: draft.community,
            title:
              title || Array.from(body.replace(/\s+/g, ' ')).slice(0, 32).join('') || '校园随拍',
            body,
            html,
            images: draft.images,
            tags:
              draft.community === 'daily' && draft.images.length && !draft.tags.length
                ? ['校园随拍']
                : draft.tags,
            ...(draft.community === 'market' && draft.price.trim()
              ? { price: '¥' + draft.price.trim() }
              : {}),
            ...(draft.community === 'buddies'
              ? { meeting: draft.meeting, ...(Number.isFinite(meetingAt) ? { meetingAt } : {}) }
              : {}),
            ...(draft.community === 'resources' && draft.projectEnabled
              ? { project: draft.project }
              : {}),
          },
        },
      ],
      (snapshot) => {
        pendingReview = snapshot.postReviews?.some((item) => item.id === id && item.status === 'pending') ?? false;
        return pendingReview ? '首帖已提交审核，可在设置中查看进度' : '已发布';
      },
    );
    if (saved) {
      localStorage.removeItem(key);
      const previousKey = 'umeet-drafts-' + data?.actor?.userId;
      try {
        const previous = JSON.parse(localStorage.getItem(previousKey) || '{}');
        delete previous.composerDraft;
        localStorage.setItem(previousKey, JSON.stringify(previous));
      } catch {
        toast('提交成功，旧草稿缓存未能清理');
      }
      closeComposer();
      navigateCommunity(pendingReview ? '#/settings/governance' : '#/posts/' + id);
    }
  };
  const board = boards.find((board) => board.slug === draft.community)!;
  const boardSettings = siteSettings?.boards[draft.community];
  return (
    <dialog
      ref={dialog}
      className="modal-card"
      id="composer"
      data-account-draft-safe
      aria-labelledby="composer-title"
      onCancel={(event) => {
        if (event.target === event.currentTarget) closeComposer();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeComposer();
      }}
    >
      <header className="modal-head">
        <h2 id="composer-title">发帖</h2>
        <button
          className="icon-btn"
          id="composer-close"
          aria-label="关闭发帖器"
          onClick={closeComposer}
        >
          <Icon name="x" />
        </button>
      </header>
      <div id="composer-body">
        <div className="cmp-body">
          <div className="cmp-destination">
            <label htmlFor="cmp-community">发布到</label>
            <select
              id="cmp-community"
              value={draft.community}
              onChange={(event) => set({ community: event.target.value as Board })}
            >
              {boards.filter(board => !isContentBoard(board.slug)).map((board) => (
                <option key={board.slug} value={board.slug}>
                  {board.name}
                </option>
              ))}
            </select>
            {draft.community === 'market' && (
              <button className="link-btn" id="cmp-rules" onClick={() => setRules(!rules)}>
                交易规则
              </button>
            )}
          </div>
          {draft.community === 'market' && rules && <MarketRules />}
          {boardSettings?.prompt && <p className="board-posting-prompt">{boardSettings.prompt}</p>}
          {boardSettings?.posting?.readonly && <p className="muted">此板块暂停发帖和回复，可选择其他板块。</p>}
          <details className="cmp-board-guide">
            <summary>{board.name} · 发帖提示</summary>
            <ul className="board-guide">
              {(boardSettings?.rules || boardGuides[draft.community] || []).map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </details>
          {draft.community === 'daily' ? (
            <details className="editor-options optional-title">
              <summary>添加标题（可选）</summary>
              <label className="sr-only" htmlFor="cmp-title">
                标题
              </label>
              <input
                type="text"
                id="cmp-title"
                maxLength={60}
                value={draft.title}
                onChange={(event) => set({ title: event.target.value })}
                placeholder="给这件小事取个标题"
              />
            </details>
          ) : (
            <div>
              <label htmlFor="cmp-title">标题</label>
              <input
                type="text"
                id="cmp-title"
                maxLength={60}
                value={draft.title}
                onChange={(event) => set({ title: event.target.value })}
                ref={titleInput}
                aria-invalid={invalidField === 'title'}
                aria-describedby={invalidField === 'title' ? 'cmp-title-error' : undefined}
                placeholder="用一句话说清这条帖子"
              />
            </div>
          )}
          {invalidField === 'title' && <p className="field-error" id="cmp-title-error" role="alert">{error}</p>}
          {draft.community === 'resources' && (
            <div className="cmp-project">
              <label className="cmp-project-toggle">
                <input
                  type="checkbox"
                  id="cmp-project-toggle"
                  checked={draft.projectEnabled}
                  onChange={(event) => set({ projectEnabled: event.target.checked })}
                />
                作为校园作品发布
              </label>
              <fieldset id="cmp-project-fields" hidden={!draft.projectEnabled}>
                <legend>作品介绍（选填）</legend>
                {(
                  [
                    ['work', '做了什么', '它解决了哪个校园里的小问题？'],
                    ['access', '怎么体验', '体验链接或使用步骤'],
                    ['feedback', '想听什么反馈', '最想请同学帮忙看什么？'],
                  ] as const
                ).map(([key, label, hint]) => (
                  <div key={key}>
                    <label htmlFor={'cmp-project-' + key}>{label}</label>
                    <input
                      type="text"
                      id={'cmp-project-' + key}
                      maxLength={300}
                      value={draft.project[key]}
                      placeholder={hint}
                      onChange={(event) =>
                        set({ project: { ...draft.project, [key]: event.target.value } })
                      }
                    />
                  </div>
                ))}
              </fieldset>
            </div>
          )}
          {draft.community === 'market' && (
            <div>
              <label htmlFor="cmp-price">价格（元）</label>
              <input
                type="text"
                id="cmp-price"
                inputMode="decimal"
                placeholder="0.00"
                value={draft.price}
                onChange={(event) => set({ price: event.target.value })}
              />
            </div>
          )}
          {draft.community === 'buddies' && (
            <>
              <div>
                <label htmlFor="cmp-when">时间与集合地点</label>
                <input
                  type="text"
                  id="cmp-when"
                  value={draft.meeting}
                  onChange={(event) => set({ meeting: event.target.value })}
                  placeholder="如：周六早八点东门集合"
                />
              </div>
              <div>
                <label htmlFor="cmp-meeting-time">活动日期与时间（可选）</label>
                <input
                  type="datetime-local"
                  id="cmp-meeting-time"
                  value={draft.meetingTime}
                  onChange={(event) => set({ meetingTime: event.target.value })}
                />
                <small>填写后可计入发现页的近期活动。</small>
              </div>
            </>
          )}
          <div>
            {composer && editorInitial && (
              <PostEditor
                invalid={invalidField === 'body'}
                errorMessage={invalidField === 'body' ? error : undefined}
                ref={editor}
                initial={editorInitial}
                onChange={set}
                onReady={setEditorReady}
                tools={
                  <>
                    <button
                      id="cmp-add-image"
                      type="button"
                      title="添加图片"
                      aria-label="添加图片"
                      onClick={() => files.current?.click()}
                    >
                      <Icon name="image" />
                    </button>
                    <button
                      id="cmp-emoji-btn"
                      ref={emojiButton}
                      onMouseDown={(event) => event.preventDefault()}
                      type="button"
                      title="添加表情"
                      aria-label="添加表情"
                      aria-expanded={emoji}
                      aria-controls="cmp-emoji"
                      aria-haspopup="dialog"
                      onClick={() => {
                        setEmoji(!emoji);
                        setTagsOpen(false);
                      }}
                    >
                      <Icon name="smile" />
                    </button>
                    <button
                      id="cmp-tag-btn"
                      ref={tagButton}
                      type="button"
                      title="添加标签"
                      aria-label="添加标签"
                      aria-expanded={tagsOpen}
                      aria-controls="cmp-tag-panel"
                      aria-haspopup="dialog"
                      onClick={() => {
                        setTagsOpen(!tagsOpen);
                        setEmoji(false);
                      }}
                    >
                      <Icon name="hash" />
                    </button>
                  </>
                }
              />
            )}
            <div className="cmp-toolbar">
              <input
                ref={files}
                type="file"
                id="cmp-file"
                accept="image/*"
                multiple
                hidden
                onChange={async (event) => {
                  const selected = [...(event.target.files || [])];
                  event.target.value = '';
                  if (selected.length + draftRef.current.images.length > 4)
                    return setError('最多添加 4 张图片');
                  try {
                    const images = await Promise.all(selected.map(readImage));
                    if (images.length + draftRef.current.images.length > 4)
                      return setError('最多添加 4 张图片');
                    set({ images: [...draftRef.current.images, ...images] });
                  } catch (failure) {
                    setError((failure as Error).message);
                  }
                }}
              />
              <span className="cnt" id="cmp-cnt">
                {plainTextSafe(draft.html)} / 2000
              </span>
            </div>
            <ToolbarPopover
              id="cmp-emoji"
              label="选择表情"
              open={Boolean(composer) && emoji}
              anchor={emojiButton}
              onClose={() => setEmoji(false)}
            >
              <div className="composer-emoji-grid">
                {emojis.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={'插入表情 ' + value}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      editor.current?.insertText(value);
                      setEmoji(false);
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </ToolbarPopover>
            <ToolbarPopover
              id="cmp-tag-panel"
              label="选择标签"
              open={Boolean(composer) && tagsOpen}
              anchor={tagButton}
              onClose={() => setTagsOpen(false)}
            >
              <header className="composer-tag-heading">
                <strong>选择标签</strong>
                <span>{draft.tags.length} / 3</span>
              </header>
              <div className="composer-tag-options">
                {postTags.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={draft.tags.includes(value)}
                    disabled={draft.tags.length >= 3 && !draft.tags.includes(value)}
                    onClick={() => toggleTag(value)}
                  >
                    <span aria-hidden="true">#</span>
                    {value}
                  </button>
                ))}
              </div>
              <p className="composer-tag-note">最多选择 3 个标签</p>
            </ToolbarPopover>
            {draft.tags.length > 0 && (
              <div className="cmp-selected-tags">
                {draft.tags.map((value) => (
                  <span className="tag" key={value}>
                    {value}
                    <button
                      aria-label={'移除标签 ' + value}
                      onClick={() => set({ tags: draft.tags.filter((item) => item !== value) })}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div id="cmp-imgs" className="cmp-imgs" hidden={!draft.images.length}>
              {draft.images.map((image, index) => (
                <div key={index}>
                  <img src={image} alt="待发布图片" />
                  <button
                    type="button"
                    aria-label="移除图片"
                    onClick={() =>
                      set({ images: draft.images.filter((_, position) => position !== index) })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <footer className="composer-footer">
        <p id="cmp-error" role="alert" hidden={!error}>
          {error}
        </p>
        <div className="cmp-actions">
          <span id="cmp-publish-note">
            以 {data?.userState.profile?.name || data?.actor?.nickname || '同学'} 的身份发布
          </span>
          <button className="btn-ghost" id="cmp-later" onClick={closeComposer}>
            稍后继续
          </button>
          <button
            className="btn-primary"
            id="cmp-submit"
            disabled={busy || !editorReady || boardSettings?.posting?.readonly}
            onClick={() => void publish()}
          >
            发布
          </button>
        </div>
      </footer>
    </dialog>
  );
}
function plainTextSafe(html: string) {
  return typeof document === 'undefined' ? 0 : plainText(html).length;
}
