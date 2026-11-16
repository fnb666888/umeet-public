'use client';
import { useRef, useState } from 'react';
import { PostEditor, type PostEditorHandle } from './PostEditor';
import { cleanHtml, plainText, type Post, type Reply } from './model';
import { useCommunity } from './store';

export function ContentCorrection({ post, reply }: { post: Post; reply?: Reply }) {
  const { busy, mutate } = useCommunity();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(reply?.body || post.body);
  const [html, setHtml] = useState(post.html || '');
  const [ready, setReady] = useState(Boolean(reply));
  const editor = useRef<PostEditorHandle>(null);
  if (!editing)
    return (
      <button type="button" className="act" onClick={() => setEditing(true)}>
        修改{reply ? '回复' : '正文'}
      </button>
    );
  return (
    <form
      className="content-correction"
      onSubmit={async (event) => {
        event.preventDefault();
        const saved = await mutate(
          reply
            ? [{ type: 'reply.edit', postId: post.id, replyId: reply.id, body }]
            : [{ type: 'post.edit', postId: post.id, title, body, html: cleanHtml(html) }],
          '修改已保存，管理标记由管理员复核后调整',
        );
        if (saved) setEditing(false);
      }}
    >
      <h3>修改{reply ? '回复' : '帖子'}</h3>
      {reply ? (
        <label>
          回复内容
          <textarea
            required
            maxLength={500}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
      ) : (
        <>
          <label>
            帖子标题
            <input
              value={title}
              required
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <PostEditor
            ref={editor}
            initial={{ html: post.html || '', md: post.body, mode: post.html ? 'rich' : 'md' }}
            onReady={setReady}
            onChange={(value) => {
              setHtml(value.html);
              setBody(plainText(value.html));
            }}
          />
        </>
      )}
      <button type="button" disabled={busy} onClick={() => setEditing(false)}>
        取消
      </button>
      <button disabled={busy || !ready || body.length > (reply ? 500 : 2000)}>保存修改</button>
    </form>
  );
}
