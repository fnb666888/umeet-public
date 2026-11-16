'use client';
import { useEffect, useState } from 'react';
import { DemoAuthDialog, switchAccount } from './DemoAuthDialog';
import { accountState } from '../lib/browser-session';
import { logout } from './community/Profile';
export function AuthControls() {
  const [member, setMember] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void fetch('/api/session/me', { cache: 'no-store' })
      .then(async (response) => {
        const actor: unknown = await response.json();
        if (active)
          setMember(
            response.ok &&
              !!actor &&
              typeof actor === 'object' &&
              'kind' in actor &&
              actor.kind === 'member',
          );
      })
      .catch(() => {
        if (active) setMessage('登录状态加载失败，请刷新重试');
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="account-controls">
      {member ? (
        <>
          <a className="user-label" href="/me/security">
            我的账号
          </a>
          <button
            className="quiet"
            onClick={switchAccount}
          >
            切换账号
          </button>
          <button
            className="quiet"
            onClick={() => void logout().catch((failure) => setMessage(failure.message))}
          >
            退出
          </button>
        </>
      ) : (
        <><button className="primary" onClick={() => window.dispatchEvent(new Event('umeet:login'))}>
          登录 / 注册
        </button>{!!accountState()?.accounts.length && <button className="quiet" onClick={switchAccount}>已保存的账号</button>}</>
      )}
      {message && <p role="status">{message}</p>}
      <DemoAuthDialog />
    </div>
  );
}
