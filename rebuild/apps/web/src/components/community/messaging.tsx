'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  InboxSummary,
  Conversation,
  Message,
  MessagePage,
} from '../../../../../packages/contracts/src/messaging';
import { useCommunity } from './store';
import { ResourceDomain } from '../../lib/resources';
// Polls always revalidate; cached conversations are used only for first paint.
export const messageResources = new ResourceDomain('messages', 0);
export type { Conversation, Message, MessagePage };
const errors: Record<string, string> = {
  REQUEST_PENDING: '等待对方接受请求后才能继续发送',
  REQUESTS_DISABLED: '对方暂未开放新的私信请求',
  CONTACT_UNAVAILABLE: '暂时无法向此用户发送消息',
  INVALID_RECIPIENT: '请选择其他用户',
  USER_NOT_FOUND: '此用户不存在',
  POST_NOT_FOUND: '引用的帖子已不可用',
  MESSAGE_RATE_LIMIT: '发送较频繁，请稍后再试',
  AUTH_REQUIRED: '登录已失效，请重新登录',
  ACCOUNT_CLOSED: '账号已注销',
  INVALID_REQUEST: '请求状态已经变化，请刷新后重试',
};
export async function messageApi<T>(path: string, body?: unknown): Promise<T> {
  if (body === undefined) return messageResources.read(path, () => sendMessage<T>(path));
  try { return await sendMessage<T>(path, body); }
  finally { messageResources.invalidate(false); }
}
async function sendMessage<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/backend/messages' + path, {
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    ...(body !== undefined
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.code === 'ACCOUNT_RESTRICTED'
    ? value.message : errors[value.message] || '消息服务暂时不可用，请重试'), {status:response.status});
  return value as T;
}
type View = 'messages' | 'requests' | 'unread';
const empty: InboxSummary = {
  conversations: [],
  next: null,
  unread: 0,
  requests: 0,
  allowRequests: true,
};
const Context = createContext<{
  summary: InboxSummary;
  view: View;
  setView: (view: View) => void;
  refresh: () => Promise<void>;
  more: () => Promise<void>;
  error: string;
  loading: boolean;
} | null>(null);
export const useMessages = () => useContext(Context)!;
export function MessagingProvider({ children }: { children: ReactNode }) {
  const { data, hash } = useCommunity();
  const user = data?.actor?.kind === 'member' && !data.suspended ? data.actor.userId : null;
  const [summary, setSummary] = useState(empty);
  const [view, setView] = useState<View>('messages');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const pages = useRef(1);
  const refresh = useCallback(async () => {
    const order = ++sequence.current;
    if (!user) {
      setSummary(empty);
      return;
    }
    try {
      let result = await messageApi<InboxSummary>('?view=' + view);
      for (let index = 1; index < pages.current && result.next; index++) {
        const next = await messageApi<InboxSummary>('?view=' + view + '&cursor=' + result.next);
        result = {
          ...next,
          conversations: [
            ...result.conversations,
            ...next.conversations.filter(
              (c) => !result.conversations.some((old) => old.peer === c.peer),
            ),
          ],
        };
      }
      if (order === sequence.current) {
        setSummary(result);
        setError('');
      }
    } catch (e) {
      if (order === sequence.current) setError((e as Error).message);
    }
  }, [user, view]);
  useEffect(() => {
    pages.current = 1;
    setLoading(true);
    setSummary(empty);
    void refresh().finally(() => setLoading(false));
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!user) return;
    const update = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(update, hash.startsWith('#/inbox') ? 4000 : 12000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
  }, [user, hash, refresh]);
  async function more() {
    if (!summary.next || loading) return;
    const order = ++sequence.current;
    setLoading(true);
    try {
      const result = await messageApi<InboxSummary>('?view=' + view + '&cursor=' + summary.next);
      if (order === sequence.current) {
        pages.current++;
        setSummary((current) => ({
          ...result,
          conversations: [
            ...current.conversations,
            ...result.conversations.filter(
              (c) => !current.conversations.some((old) => old.peer === c.peer),
            ),
          ],
        }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Context.Provider value={{ summary, view, setView, refresh, more, error, loading }}>
      {children}
    </Context.Provider>
  );
}
