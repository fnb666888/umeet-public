'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { installBrowserSession, refreshAccounts, setAccountState } from '../lib/browser-session';
import { AccountSwitcher } from './AccountSwitcher';
import { usePathname } from 'next/navigation';
import { AccountSessionContext } from '../lib/account-session-context';
import { InitialActorContext, type InitialActor } from '../lib/initial-actor';
export function AccountSessionProvider({ children, initialActor = null }: { children: ReactNode; initialActor?: InitialActor }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [changing, setChanging] = useState(false),
    [attempt, retry] = useState(0);
  useEffect(() => {
    const dispose = installBrowserSession();
    const status = (event: Event) => setChanging((event as CustomEvent<boolean>).detail);
    window.addEventListener('umeet:account-transition', status);
    let active = true;
    void (async () => {
      try {
        const state = await refreshAccounts();
        if (!active) return;
        // Adopt an already signed-in member once; guests do not consume a slot.
        if (
          state.currentUserId &&
          !state.accounts.some((account) => account.userId === state.currentUserId)
        ) {
          const response = await fetch('/api/session/me', { cache: 'no-store' });
          const actor = response.ok ? await response.json() : null;
          if (actor?.kind === 'member') {
            const remembered = await fetch('/api/session/remember', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ version: state.version }),
            });
            if (!remembered.ok) throw new Error('无法保存当前账号，请刷新后重试');
            setAccountState((await remembered.json()).state);
          }
        }
        if (active) {
          setError('');
          setReady(true);
        }
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : '账号服务暂时不可用');
      }
    })();
    return () => {
      active = false;
      window.removeEventListener('umeet:account-transition', status);
      dispose();
    };
  }, [attempt]);
  if (!ready && pathname === '/account/dispositions' && !initialActor)
    return (
      <main className="account-loading" role="status">
        {error || '正在加载社区…'}
        {error && <button onClick={() => retry((value) => value + 1)}>重试</button>}
      </main>
    );
  return (
    <InitialActorContext.Provider value={initialActor}><AccountSessionContext.Provider value={ready}>
      {children}
      {error && <p role="status">{error} <button onClick={() => retry(value => value + 1)}>重试账号连接</button></p>}
      {ready && <AccountSwitcher />}
      {changing && (
        <div className="account-transition-notice" role="status">
          正在处理账号切换，请暂时保留当前页面…
        </div>
      )}
    </AccountSessionContext.Provider></InitialActorContext.Provider>
  );
}
