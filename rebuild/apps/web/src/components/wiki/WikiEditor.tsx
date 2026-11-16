'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewOptionsCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import {
  commonmark,
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInBulletListCommand,
} from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { getMarkdown, replaceAll, callCommand, $prose } from '@milkdown/kit/utils';
import { Plugin } from '@milkdown/kit/prose/state';
import { parseMarkdown } from '../../../../../packages/markdown/src/parse';
import { validateDocument } from '../../../../../packages/markdown/src/schema';
import { normalizeMarkdown } from '../../../../../packages/markdown/src/normalize';
type Props = {
  value: string;
  onChange: (value: string) => void;
  onUnsupported: (message: string) => void;
};
function VisualEditor({ value, onChange, onUnsupported }: Props) {
  const root = useRef<HTMLDivElement>(null),
    instance = useRef<Editor | null>(null),
    initial = useRef(value),
    current = useRef(value),
    callbacks = useRef({ onChange, onUnsupported });
  callbacks.current = { onChange, onUnsupported };
  useEffect(() => {
    if (!root.current) return;
    let cancelled = false;
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root.current!);
        ctx.set(defaultValueCtx, initial.current);
        ctx.update(editorViewOptionsCtx, (options) => ({
          ...options,
          attributes: {
            ...options.attributes,
            role: 'textbox',
            'aria-label': '可视化正文',
            'aria-multiline': 'true',
          },
        }));
      })
      .use(commonmark)
      .use(gfm)
      .use(
        $prose(
          (ctx) =>
            new Plugin({
              view: () => ({
                update(view, previous) {
                  if (view.state.doc.eq(previous.doc)) return;
                  const markdown = ctx.get(serializerCtx)(view.state.doc);
                  const validation = validateDocument(parseMarkdown(markdown));
                  if (!validation.valid) {
                    callbacks.current.onUnsupported(
                      validation.issues[0]?.message || '正文结构暂不支持，已保留原稿。',
                    );
                    editor.action(replaceAll(current.current));
                    return;
                  }
                  current.current = markdown;
                  callbacks.current.onChange(markdown);
                },
              }),
            }),
        ),
      );
    void editor
      .create()
      .then(async () => {
        if (cancelled) {
          await editor.destroy();
          return;
        }
        const converted = editor.action(getMarkdown());
        if (
          JSON.stringify(normalizeMarkdown(initial.current)) !==
          JSON.stringify(normalizeMarkdown(converted))
        ) {
          callbacks.current.onUnsupported(
            '这段内容转换为可视化后会变化，已保留完整 Markdown 原稿，请使用源码继续编辑。',
          );
          await editor.destroy();
          return;
        }
        instance.current = editor;
      })
      .catch(() =>
        callbacks.current.onUnsupported(
          '可视化编辑器暂时无法启动，原稿已保留，可切换 Markdown 编辑。',
        ),
      );
    return () => {
      cancelled = true;
      instance.current = null;
      void editor.destroy();
    };
  }, []);
  function command(kind: 'bold' | 'italic' | 'list') {
    const editor = instance.current;
    if (editor)
      editor.action(
        callCommand(
          kind === 'bold'
            ? toggleStrongCommand.key
            : kind === 'italic'
              ? toggleEmphasisCommand.key
              : wrapInBulletListCommand.key,
        ),
      );
  }
  return (
    <>
      <div className="format-toolbar" aria-label="文字格式">
        <button type="button" onClick={() => command('bold')}>
          加粗
        </button>
        <button type="button" onClick={() => command('italic')}>
          斜体
        </button>
        <button type="button" onClick={() => command('list')}>
          列表
        </button>
        <span>也可直接输入 Markdown 语法</span>
      </div>
      <div
        ref={root}
        className="visual-editor"
        onPasteCapture={(event) => {
          const html = event.clipboardData.getData('text/html');
          if (
            html &&
            (/<(script|iframe|object|embed|style|svg|video|audio)\b/i.test(html) ||
              /\son\w+\s*=/i.test(html))
          ) {
            event.preventDefault();
            callbacks.current.onUnsupported(
              '粘贴内容含不支持的结构，原稿未改动。请改用纯文本或 Markdown。',
            );
          }
        }}
      />
    </>
  );
}
export function WikiEditor(props: Props) {
  const [mode, setMode] = useState<'visual' | 'source'>('visual'),
    [notice, setNotice] = useState('');
  function unsupported(message: string) {
    setNotice(message);
    setMode('source');
    props.onUnsupported(message);
  }
  function visual() {
    const validation = validateDocument(parseMarkdown(props.value));
    if (!validation.valid) {
      unsupported(validation.issues[0]?.message || '请先调整源码中的不支持结构。');
      return;
    }
    setNotice('');
    setMode('visual');
  }
  return (
    <div className="wiki-editor">
      <div className="editor-tabs">
        <button type="button" aria-pressed={mode === 'visual'} onClick={visual}>
          可视化
        </button>
        <button type="button" aria-pressed={mode === 'source'} onClick={() => setMode('source')}>
          Markdown 源码
        </button>
      </div>
      {notice && (
        <p className="editor-notice" role="alert">
          {notice}
        </p>
      )}
      {mode === 'visual' ? (
        <VisualEditor {...props} onUnsupported={unsupported} />
      ) : (
        <label className="source-label">
          Markdown 正文
          <textarea
            aria-label="Markdown 正文"
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            maxLength={500000}
            spellCheck={false}
          />
        </label>
      )}
    </div>
  );
}
