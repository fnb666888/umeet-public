// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { PostPoll } from '../src/components/interest/Poll';
import { ForecastList, NewsList } from '../src/components/interest/Discover';
const mocks = vi.hoisted(() => ({
  result: { data: null as unknown, loading: false, error: '', refresh: vi.fn() },
  send: vi.fn(),
  login: vi.fn(() => true),
  toast: vi.fn(),
}));
vi.mock('../src/components/interest/api', () => ({
  useInterest: () => mocks.result,
  interestApi: mocks.send,
}));
vi.mock('../src/components/community/store', () => ({
  useCommunity: () => ({ requireLogin: mocks.login, toast: mocks.toast }),
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mocks.send.mockReset().mockResolvedValue({});
  mocks.login.mockReset().mockReturnValue(true);
  mocks.result.refresh.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
describe('interest interactions', () => {
  it('keeps saved, follow and pagination links within the news board', async () => {
    mocks.result.data = { items: [], next: '2030-01-01T00:00:00.000Z|item' };
    await act(async () => root.render(<NewsList params={new URLSearchParams('board=ai')} />));
    const urls = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(urls).toContain('#/c/news?board=ai&saved=true');
    expect(urls).toContain('#/c/news?board=ai&followed=true');
    expect(urls.some((url) => url?.startsWith('#/c/news?board=ai&cursor='))).toBe(true);
    expect(urls.some((url) => url?.includes('/discover'))).toBe(false);
  });
  it('submits an existing single choice and removes author editing after the first vote', async () => {
    mocks.result.data = {
      poll: {
        id: 'poll',
        postId: 'post',
        question: 'Which?',
        options: [
          { text: 'A', count: 1 },
          { text: 'B', count: 0 },
        ],
        endsAt: new Date(Date.now() + 60000).toISOString(),
        state: 'open',
        total: 1,
        myVote: null,
        canEdit: false,
        version: 1,
      },
    };
    await act(async () => root.render(<PostPoll postId="post" own />));
    expect(host.textContent).toContain('仅公开汇总');
    expect(host.textContent).not.toContain('编辑问题');
    await act(async () =>
      host.querySelectorAll<HTMLButtonElement>('.interest-poll-options button')[1]!.click(),
    );
    expect(mocks.send).toHaveBeenCalledWith('polls/post/vote', { option: 1, version: 1 });
    expect(mocks.result.refresh).toHaveBeenCalled();
    mocks.login.mockReturnValue(false);
    mocks.send.mockClear();
    await act(async () =>
      host.querySelectorAll<HTMLButtonElement>('.interest-poll-options button')[0]!.click(),
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('shows unavailable prediction sources without fabricating a probability', async () => {
    mocks.result.data = {
      items: [],
      next: null,
      today: { state: 'paused', reason: 'Unavailable', business_day: '2030-01-01' },
      fields: [{ field: 'sports', ready: false, reason: 'No verified source' }],
      score: { resolved: 0, brier: null },
    };
    await act(async () =>
      root.render(<ForecastList params={new URLSearchParams('tab=forecasts')} />),
    );
    expect(host.textContent).toContain('今日预测暂停');
    expect(host.textContent).toContain('来源或题型未就绪');
    expect(host.querySelector('.interest-probability')).toBeNull();
  });
});
