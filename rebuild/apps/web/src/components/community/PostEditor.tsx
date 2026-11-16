'use client';
import { useEffect, useRef, useState, useImperativeHandle, type Ref, type ReactNode } from 'react';
import { htmlMarkdown, RichText } from './content';
import { postMarkdownHtml } from './markdown';

export type PostEditorHandle = { insertText: (text: string) => void; focus: () => void };
type Props = {
  initial: { html: string; md: string; mode: 'rich' | 'md' };
  onChange: (value: { html: string; md: string; mode: 'md' }) => void;
  onReady: (ready: boolean) => void;
  tools?: ReactNode;
  ref: Ref<PostEditorHandle>;
  invalid?: boolean;
  errorMessage?: string;
};
export function PostEditor({ initial, onChange, onReady, tools, ref, invalid, errorMessage }: Props) {
  const [source, setSource] = useState(() =>
    initial.mode === 'md' ? initial.md : htmlMarkdown(initial.html),
  );
  const [view, setView] = useState<'content' | 'preview'>('content');
  const input = useRef<HTMLTextAreaElement>(null);
  const current = useRef(source);
  const callbacks = useRef({ onChange, onReady });
  callbacks.current = { onChange, onReady };
  const selection = useRef({ start: source.length, end: source.length });
  const history = useRef([source]);
  const position = useRef(0);
  function update(value: string, record = true) {
    current.current = value;
    setSource(value);
    if (record) {
      history.current = history.current.slice(0, position.current + 1);
      history.current.push(value);
      position.current++;
    }
    callbacks.current.onChange({ md: value, html: postMarkdownHtml(value), mode: 'md' });
  }
  useEffect(() => {
    callbacks.current.onChange({
      md: current.current,
      html: postMarkdownHtml(current.current),
      mode: 'md',
    });
    callbacks.current.onReady(true);
    return () => callbacks.current.onReady(false);
  }, []);
  function replace(before: string, after = '', placeholder = '', insert = false) {
    const value = current.current;
    const { start, end } = selection.current;
    const text = insert ? '' : value.slice(start, end) || placeholder;
    const remove =
      !insert &&
      before &&
      value.slice(Math.max(0, start - before.length), start) === before &&
      value.slice(end, end + after.length) === after;
    const from = remove ? start - before.length : start;
    const to = remove ? end + after.length : end;
    const inserted = remove ? text : before + text + after;
    update(value.slice(0, from) + inserted + value.slice(to));
    setView('content');
    window.requestAnimationFrame(() => {
      input.current?.focus();
      const next = remove ? from : from + before.length;
      input.current?.setSelectionRange(next, next + text.length);
      selection.current = { start: next, end: next + text.length };
    });
  }
  useImperativeHandle(ref, () => ({
    focus() { setView('content'); requestAnimationFrame(() => input.current?.focus()); },
    insertText(text) {
      replace(text, '', '', true);
    },
  }));
  function undo(direction: number) {
    const next = Math.max(0, Math.min(history.current.length - 1, position.current + direction));
    if (next === position.current) return;
    position.current = next;
    const value = history.current[next];
    update(value, false);
    selection.current = { start: value.length, end: value.length };
    window.requestAnimationFrame(() =>
      input.current?.setSelectionRange(value.length, value.length),
    );
  }
  function format(kind: string) {
    if (kind === 'undo' || kind === 'redo') return undo(kind === 'undo' ? -1 : 1);
    if (kind === 'link') {
      const href = window.prompt('输入链接地址');
      if (href && /^(https?:|mailto:)/i.test(href)) replace('[', '](' + href + ')', '链接文字');
      return;
    }
    if (kind === 'code') {
      const { start, end } = selection.current;
      const value = current.current;
      const selected = value.slice(start, end);
      const fence = String.fromCharCode(96).repeat(
        Math.max(3, ...[...selected.matchAll(/\x60+/g)].map((match) => match[0].length + 1)),
      );
      replace(
        (start > 0 && value[start - 1] !== '\n' ? '\n' : '') + fence + '\n',
        '\n' + fence + (end < value.length && value[end] !== '\n' ? '\n' : ''),
        '代码',
      );
      return;
    }
    const wrappers: Record<string, [string, string]> = {
      bold: ['**', '**'],
      italic: ['*', '*'],
      underline: ['<u>', '</u>'],
      strike: ['~~', '~~'],
    };
    if (wrappers[kind]) {
      replace(...wrappers[kind], '文字');
      return;
    }
    const value = current.current;
    const start =
      selection.current.start === 0 ? 0 : value.lastIndexOf('\n', selection.current.start - 1) + 1;
    const endIndex = value.indexOf('\n', selection.current.end);
    const end = endIndex < 0 ? value.length : endIndex;
    selection.current = { start, end };
    const prefixes: Record<string, string> = {
      heading: '## ',
      bullet: '- ',
      ordered: '1. ',
      quote: '> ',
    };
    const prefix = prefixes[kind];
    if (prefix) {
      const lines = value.slice(start, end).split('\n');
      const remove = lines.every((line) => line.startsWith(prefix));
      setView('content');
      const next = lines
        .map((line) => (remove ? line.slice(prefix.length) : prefix + line))
        .join('\n');
      update(value.slice(0, start) + next + value.slice(end));
      selection.current = { start, end: start + next.length };
      window.requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.setSelectionRange(start, start + next.length);
      });
    }
  }
  return (
    <section className="post-editor" aria-label="正文编辑器">
      <div className="post-editor-tabs" aria-label="编辑视图">
        {(
          [
            ['content', '内容'],
            ['preview', '预览'],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={view === value}
            onClick={() => setView(value)}
          >
            {label}
          </button>
        ))}
        <span>Markdown 源码 · 预览查看排版</span>
      </div>
      <div className="post-format-toolbar" aria-label="正文排版工具">
        {[
          ['heading', '标题', 'H₂'],
          ['bold', '加粗', 'B'],
          ['italic', '斜体', 'I'],
          ['underline', '下划线', 'U'],
          ['strike', '删除线', 'S'],
          ['bullet', '无序列表', '☷'],
          ['ordered', '有序列表', '1.'],
          ['quote', '引用', '❞'],
          ['code', '代码块', '</>'],
          ['link', '链接', '链接'],
          ['undo', '撤销', '↶'],
          ['redo', '重做', '↷'],
        ].map(([kind, label, text]) => (
          <button
            key={kind}
            type="button"
            title={label}
            aria-label={label}
            disabled={view === 'preview'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format(kind)}
          >
            {text}
          </button>
        ))}
        <span className="post-tool-divider" />
        {tools}
      </div>
      <div className="post-editor-panes">
        {invalid && <p className="field-error" id="post-body-error" role="alert">{errorMessage}</p>}
        <textarea
          aria-invalid={invalid}
          aria-describedby={invalid ? 'post-body-error' : undefined}
          ref={input}
          className="post-markdown-input"
          aria-label="正文 Markdown 源码"
          hidden={view === 'preview'}
          value={source}
          placeholder="写下你想分享的内容，支持 Markdown 格式…"
          spellCheck={false}
          onSelect={(event) => {
            if (document.activeElement !== event.currentTarget) return;
            selection.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            };
          }}
          onBlur={(event) => {
            selection.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            };
          }}
          onChange={(event) => {
            selection.current = {
              start: event.target.selectionStart,
              end: event.target.selectionEnd,
            };
            update(event.target.value);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              if (event.key.toLowerCase() === 'z') {
                event.preventDefault();
                undo(event.shiftKey ? 1 : -1);
              }
              if (event.key.toLowerCase() === 'y') {
                event.preventDefault();
                undo(1);
              }
              if (event.key.toLowerCase() === 'b' || event.key.toLowerCase() === 'i') {
                event.preventDefault();
                format(event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
              }
            }
          }}
        />
        {view === 'preview' && (
          <article className="post-editor-preview" aria-label="正文预览">
            {source.trim() ? (
              <RichText html={postMarkdownHtml(source)} />
            ) : (
              <p className="muted">正文预览会显示在这里</p>
            )}
          </article>
        )}
      </div>
    </section>
  );
}
