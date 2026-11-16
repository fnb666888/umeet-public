'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  KnowledgeContent,
  KnowledgeDraftInput,
} from '../../../../../packages/contracts/src/knowledge';
import { knowledge, KnowledgeError, failureMessage } from './knowledge-client';
export type SavedDraft = KnowledgeDraftInput & {
  draftId: string;
  version: number;
  savedAt: string;
};
export function useKnowledgeDraft({
  accountId,
  editingTaskId,
  initial,
  pageId,
}: {
  accountId: string;
  editingTaskId: string;
  initial: KnowledgeContent;
  pageId: string | null;
}) {
  const [content, setContent] = useState(initial),
    [loaded, setLoaded] = useState(false),
    [state, setState] = useState<'saving' | 'saved' | 'failed' | 'conflict'>('saved'),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const current = useRef(initial),
    page = useRef(pageId),
    version = useRef(0),
    saved = useRef(''),
    active = useRef(true),
    pending = useRef<Promise<void> | null>(null),
    blocked = useRef(false);
  current.current = content;
  useEffect(() => {
    active.current = true;
    let disposed = false;
    void knowledge<{ draft: SavedDraft | null }>('drafts/' + encodeURIComponent(editingTaskId), {
      accountId,
    })
      .then(({ draft: d }) => {
        if (disposed) return;
        const value = d?.content ?? initial;
        current.current = value;
        page.current = d?.pageId ?? pageId;
        version.current = d?.version ?? 0;
        saved.current = JSON.stringify(value);
        setContent(value);
        setLoaded(true);
      })
      .catch((e) => {
        if (!disposed) {
          setError(failureMessage(e));
          setState('failed');
        }
      });
    return () => {
      disposed = true;
      active.current = false;
    };
  }, [accountId, editingTaskId]);
  const flush = useCallback(async () => {
    if (pending.current) {
      await pending.current;
      return;
    }
    if (blocked.current) throw new Error('草稿版本冲突，请比较或另存当前稿。');
    const work = async () => {
      while (active.current && saved.current !== JSON.stringify(current.current)) {
        const value = current.current,
          serialized = JSON.stringify(value);
        setState('saving');
        setError('');
        try {
          const r = await knowledge<{ version: number }>('drafts', {
            method: 'PUT',
            accountId,
            body: {
              editingTaskId,
              pageId: page.current,
              expectedVersion: version.current,
              content: value,
            },
          });
          if (!active.current) return;
          version.current = r.version;
          saved.current = serialized;
          setState('saved');
        } catch (e) {
          if (active.current) {
            blocked.current = e instanceof KnowledgeError && e.code === 'DRAFT_CONFLICT';
            setState(blocked.current ? 'conflict' : 'failed');
            setError(failureMessage(e));
          }
          throw e;
        }
      }
    };
    const job = work();
    pending.current = job;
    try {
      await job;
    } finally {
      pending.current = null;
    }
  }, [accountId, editingTaskId]);
  useEffect(() => {
    if (!loaded || blocked.current || saved.current === JSON.stringify(content)) return;
    setState('saving');
    const timer = setTimeout(() => {
      void flush().catch(() => {
        /* failure is visible through state and error */
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [content, loaded, flush, revision]);
  useEffect(() => {
    const beforeAccountChange = (event: Event) => {
      if (loaded) (event as CustomEvent<{ waitUntil: (job: Promise<unknown>) => void }>).detail.waitUntil(flush());
      else event.preventDefault();
    };
    window.addEventListener('umeet:before-account-change', beforeAccountChange);
    return () => window.removeEventListener('umeet:before-account-change', beforeAccountChange);
  }, [loaded, flush]);
  useEffect(() => {
    const dirty = () => saved.current !== JSON.stringify(current.current);
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const click = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target.closest('a') : null;
      if (
        target?.getAttribute('href') &&
        !target.getAttribute('href')?.startsWith('#') &&
        dirty() &&
        !window.confirm('仍有内容尚未保存。确定离开编辑页？')
      )
        e.preventDefault();
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, []);
  async function attachPage(id: string) {
    page.current = id;
    saved.current = '';
    await flush();
  }
  async function finish() {
    await flush();
    await knowledge('drafts/' + encodeURIComponent(editingTaskId), { method: 'DELETE', accountId });
    saved.current = JSON.stringify(current.current);
  }
  async function fork() {
    const task = crypto.randomUUID();
    await knowledge('drafts', {
      method: 'PUT',
      accountId,
      body: {
        editingTaskId: task,
        pageId: page.current,
        expectedVersion: 0,
        content: current.current,
      },
    });
    saved.current = JSON.stringify(current.current);
    return task;
  }
  return {
    content,
    setContent,
    loaded,
    state,
    error,
    flush,
    attachPage,
    finish,
    fork,
    compareServer: () =>
      knowledge<{ draft: SavedDraft | null }>('drafts/' + encodeURIComponent(editingTaskId), {
        accountId,
      }),
    pageId: page.current,
    retry: () => {
      setRevision((x) => x + 1);
      void flush().catch(() => {});
    },
  };
}
