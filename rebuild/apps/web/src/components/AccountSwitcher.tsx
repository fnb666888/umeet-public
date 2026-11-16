'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  ChevronRight,
  LogOut,
  Trash2,
  UserRoundPlus,
  X,
} from 'lucide-react';
import type { BrowserAccount } from '../../../../packages/contracts/src/browser-accounts';
import { accountRequest } from './community/account-client';
import {
  accountState,
  cancelAccountChange,
  finishAccountChange,
  prepareAccountChange,
  refreshAccounts,
  setAccountState,
  subscribeAccounts,
} from '../lib/browser-session';
import './account-switcher.css';
export function AccountSwitcher() {
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLElement | null>(null);
  const [state, setState] = useState(accountState),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => subscribeAccounts(() => setState(accountState())), []);
  useEffect(() => {
    const open = () => {
      trigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setError('');
      dialog.current?.showModal();
      void refreshAccounts().catch((failure) => setError(failure.message));
    };
    window.addEventListener('umeet:accounts', open);
    return () => window.removeEventListener('umeet:accounts', open);
  }, []);
  function add(username?: string) {
    dialog.current?.close();
    window.dispatchEvent(
      new CustomEvent('umeet:login', {
        detail: { switchAccount: true, username, trigger: trigger.current },
      }),
    );
  }
  async function act(action: 'switch' | 'remove' | 'logout-all', account?: BrowserAccount) {
    if (busy || !state) return;
    if (
      action === 'remove' &&
      !window.confirm('从此浏览器移除“' + account!.nickname + '”？以后使用时需要重新登录。')
    )
      return;
    if (action === 'logout-all' && !window.confirm('退出并移除此浏览器记住的所有账号？')) return;
    setBusy(true);
    setError('');
    const changesCurrent = action !== 'remove' || account?.userId === state.currentUserId;
    try {
      if (changesCurrent) await prepareAccountChange();
      const result = (await accountRequest('/api/session/' + action, {
        version: state.version,
        ...(account ? { accountId: account.id } : {}),
      })) as { state: NonNullable<ReturnType<typeof accountState>> };
      setAccountState(result.state);
      if (changesCurrent) finishAccountChange();
    } catch (failure) {
      cancelAccountChange();
      setError(failure instanceof Error ? failure.message : '操作失败，请重试');
      // Update the displayed version after a concurrent action without changing identity in-place.
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="account-picker"
      aria-labelledby="account-picker-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={() =>
        requestAnimationFrame(() => {
          if (trigger.current?.isConnected) trigger.current.focus();
          else
            (
              document.getElementById('btn-avatar') ??
              document.getElementById('admin-switch-account')
            )?.focus();
        })
      }
    >
      <header className="account-picker-head">
        <span className="account-picker-symbol">
          <ArrowRightLeft size={22} />
        </span>
        <div>
          <h2 id="account-picker-title">切换账号</h2>
          <p>选择已登录账号，快速返回你的社区身份</p>
        </div>
        <button
          className="account-picker-close"
          aria-label="关闭账号选择"
          disabled={busy}
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
      </header>
      <div className="account-picker-body" aria-busy={busy}>
        <div className="account-picker-label">
          <span>此浏览器的账号</span>
          <span>{state?.accounts.length ?? 0} / 5</span>
        </div>
        {error && (
          <p className="account-picker-error" role="alert">
            {error}
          </p>
        )}
        {!state?.accounts.length && (
          <p className="account-picker-empty">还没有保存的账号。登录一次，即可在这里快捷切换。</p>
        )}
        <ul className="account-picker-list">
          {state?.accounts.map((account) => {
            const current = account.userId === state.currentUserId;
            return (
              <li key={account.id} className={current ? 'is-current' : ''}>
                <button
                  className="account-picker-account"
                  disabled={busy || current || account.status === 'blocked'}
                  onClick={() =>
                    account.status === 'expired'
                      ? add(account.username)
                      : void act('switch', account)
                  }
                >
                  <span className="account-picker-avatar" aria-hidden="true">
                    {account.nickname.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="account-picker-identity">
                    <strong>{account.nickname}</strong>
                    <span>@{account.username}</span>
                    <small>{account.roleLabel}</small>
                  </span>
                  <span className="account-picker-status">
                    {current ? (
                      <>
                        <Check size={16} />
                        当前
                      </>
                    ) : account.status === 'expired' ? (
                      '重新登录'
                    ) : account.status === 'blocked' ? (
                      '暂不可用'
                    ) : (
                      <ChevronRight size={18} />
                    )}
                  </span>
                </button>
                <button
                  className="account-picker-remove"
                  aria-label={'移除账号 ' + account.username}
                  title="从此浏览器移除"
                  disabled={busy}
                  onClick={() => void act('remove', account)}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            );
          })}
        </ul>
        <button
          className="account-picker-add"
          disabled={busy || (state?.accounts.length ?? 0) >= 5}
          onClick={() => add()}
        >
          <UserRoundPlus size={19} />
          <span>添加其他账号</span>
        </button>
        <p className="account-picker-note">
          {state?.accounts.length === 5
            ? '已保存 5 个账号，移除一个后可添加新账号。'
            : '最多记住 5 个账号；登录过期后需要重新验证。'}
          <br />
          切换会同步到此浏览器的其他 Umeet 标签页。
        </p>
      </div>
      <footer>
        <button disabled={busy || !state?.accounts.length} onClick={() => void act('logout-all')}>
          <LogOut size={17} />
          退出所有账号
        </button>
        <span>{busy ? '正在处理，请稍候…' : '仅记住登录状态，不保存密码'}</span>
      </footer>
    </dialog>
  );
}
