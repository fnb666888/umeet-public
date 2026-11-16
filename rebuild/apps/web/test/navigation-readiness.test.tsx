// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setAccountState } from '../src/lib/browser-session';
import { readKnowledge, cachedKnowledgeRead, knowledge } from '../src/components/knowledge/knowledge-client';
import { useKnowledge } from '../src/components/knowledge/useKnowledge';
let version = 100;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setAccountState({ deviceId: 'navigation', version: ++version, currentUserId: 'alice', accounts: [] });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('shows an existing article immediately while an expired read refreshes slowly', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"title":"Prepared article"}')));
  await readKnowledge('pages/prepared');
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 31000);
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  function Article() { const r = useKnowledge<{title:string}>('pages/prepared'); return <div>{r.loading ? 'loading' : r.data?.title}</div>; }
  try {
    await act(async () => root.render(<Article />));
    expect(host.textContent).toBe('Prepared article');
    await act(async () => finish(new Response('{"title":"Updated article"}')));
    expect(host.textContent).toBe('Updated article');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it('shares intent prefetches and keeps the shared request alive when one view leaves', async () => {
  let finish!: (response: Response) => void;
  const send = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', send);
  const abort = new AbortController();
  const view = readKnowledge('pages/shared', abort.signal);
  const failure = expect(view).rejects.toThrow('Aborted');
  const preload = readKnowledge('pages/shared');
  expect(send).toHaveBeenCalledTimes(1);
  abort.abort(); await failure;
  finish(new Response('{"title":"Shared"}')); await preload;
  expect(cachedKnowledgeRead('pages/shared')).toEqual({ title: 'Shared' });
});
it('invalidates preloaded content after writes and after switching identity', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"title":"Private scope"}')));
  await readKnowledge('pages/private');
  await knowledge('pages/private', { method: 'PUT', body: {} });
  expect(cachedKnowledgeRead('pages/private')).toBeUndefined();
  await readKnowledge('pages/private');
  setAccountState({ deviceId: 'navigation', version: ++version, currentUserId: 'bob', accounts: [] });
  expect(cachedKnowledgeRead('pages/private')).toBeUndefined();
});
