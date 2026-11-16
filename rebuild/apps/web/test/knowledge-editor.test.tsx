// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { KnowledgeContent } from '../../../packages/contracts/src/knowledge';
import { useKnowledgeDraft } from '../src/components/knowledge/useKnowledgeDraft';
import { KnowledgeError } from '../src/components/knowledge/knowledge-client';
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../src/components/knowledge/knowledge-client', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../src/components/knowledge/knowledge-client')>();
  return { ...original, knowledge: send };
});
let host: HTMLDivElement, root: Root;
const initial: KnowledgeContent = {
  title: 'initial',
  summary: 'summary',
  markdown: 'body',
  template: 'handbook',
  relations: [],
  baseRevisionId: null,
  changeNote: '',
};
function Harness({ accountId = 'A' }: { accountId?: string }) {
  const d = useKnowledgeDraft({ accountId, editingTaskId: 'editing', initial, pageId: null });
  return (
    <>
      <span data-state>{d.state}</span>
      <span data-title>{d.content.title}</span>
      <span data-error>{d.error}</span>
      <button onClick={() => d.setContent((v) => ({ ...v, title: 'changed-' + accountId }))}>
        change
      </button>
      <button onClick={d.retry}>retry</button>
    </>
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.useFakeTimers();
  send.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const click = async (index: number) => {
  await act(async () => host.querySelectorAll('button')[index]!.click());
};
const tick = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(850);
  });
};
describe('private knowledge draft interaction', () => {
  it('restores full server content before allowing autosave', async () => {
    send.mockResolvedValue({
      draft: { content: { ...initial, title: 'restored' }, pageId: null, version: 4 },
    });
    await act(async () => root.render(<Harness />));
    expect(host.querySelector('[data-title]')!.textContent).toBe('restored');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('shows save failure and only shows saved after the retry is acknowledged', async () => {
    send.mockImplementation((path: string, options?: { method?: string }) =>
      options?.method === 'PUT'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ draft: null }),
    );
    await act(async () => root.render(<Harness />));
    await click(0);
    await tick();
    expect(host.querySelector('[data-state]')!.textContent).toBe('failed');
    expect(host.querySelector('[data-title]')!.textContent).toBe('changed-A');
    send.mockResolvedValue({ version: 1 });
    await click(1);
    expect(host.querySelector('[data-state]')!.textContent).toBe('saved');
  });
  it('does not let a late response from account A replace account B content', async () => {
    let resolveA: (value: { version: number }) => void = () => {};
    send.mockImplementation((path: string, options?: { method?: string; accountId?: string }) =>
      options?.method === 'PUT'
        ? new Promise<{ version: number }>((resolve) => {
            resolveA = resolve;
          })
        : Promise.resolve({
            draft: { content: { ...initial, title: options?.accountId }, version: 0, pageId: null },
          }),
    );
    await act(async () => root.render(<Harness key="A" accountId="A" />));
    await click(0);
    await tick();
    await act(async () => root.render(<Harness key="B" accountId="B" />));
    await act(async () => resolveA({ version: 1 }));
    expect(host.querySelector('[data-title]')!.textContent).toBe('B');
    expect(send.mock.calls.find((call) => call[1]?.method === 'PUT')?.[1].accountId).toBe('A');
  });
  it('keeps the local draft and blocks automatic overwrite after device conflict', async () => {
    send.mockImplementation((path: string, options?: { method?: string }) =>
      options?.method === 'PUT'
        ? Promise.reject(new KnowledgeError('newer draft', 'DRAFT_CONFLICT', 409))
        : Promise.resolve({ draft: null }),
    );
    await act(async () => root.render(<Harness />));
    await click(0);
    await tick();
    const calls = send.mock.calls.length;
    expect(host.querySelector('[data-state]')!.textContent).toBe('conflict');
    await tick();
    expect(send.mock.calls.length).toBe(calls);
    expect(host.querySelector('[data-title]')!.textContent).toBe('changed-A');
  });
});
