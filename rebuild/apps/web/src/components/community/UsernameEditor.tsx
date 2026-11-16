'use client';
import { useState } from 'react';
import type { AccountOverview } from '../../../../../packages/contracts/src/account';
import { useCommunity } from './store';
import { accountRequest } from './account-client';
import { IdentityVerification } from './IdentityVerification';
import { Modal } from './Wiki';

export function UsernameEditor({
  account,
  saved,
}: {
  account: AccountOverview;
  saved: () => Promise<void>;
}) {
  const { refresh } = useCommunity();
  const [verifying, setVerifying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState(account.handle || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <div className="username-editor">
      {editing ? (
        <form
          className="username-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            if (
              handle.trim().toLowerCase() !== account.handle &&
              !confirm('用户名只有一次修改机会，确认使用这个用户名？')
            )
              return;
            setBusy(true);
            setMessage('');
            try {
              await accountRequest('/api/backend/account/profile', { handle });
              await refresh();
              await saved();
              window.dispatchEvent(new Event('umeet:account-updated'));
              setEditing(false);
              setMessage('用户名已保存');
            } catch (failure) {
              setMessage(failure instanceof Error ? failure.message : '保存失败');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="profile-username">新用户名</label>
          <input
            id="profile-username"
            value={handle}
            required
            minLength={3}
            maxLength={32}
            pattern="[a-z0-9_][a-z0-9_\-]{2,31}"
            autoComplete="username"
            autoFocus
            disabled={busy}
            onChange={(event) => setHandle(event.target.value.toLowerCase())}
          />
          <div className="username-actions">
            <button className="btn-primary" disabled={busy} type="submit">
              {busy ? '保存中…' : '确认修改'}
            </button>
            <button
              className="btn-ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setMessage('');
              }}
            >
              取消
            </button>
          </div>
        </form>
      ) : (
        <div className="username-current">
          <strong>{account.handle}</strong>
          {account.usernameChangesRemaining > 0 && (
            <button
              className="link-btn"
              onClick={() => {
                setHandle(account.handle || '');
                setMessage('');
                setVerifying(true);
              }}
            >
              修改用户名
            </button>
          )}
        </div>
      )}
      <p className="auth-note">
        {account.usernameChangesRemaining > 0
          ? '用户名全站唯一，你有一次修改机会。'
          : '用户名修改机会已使用。'}
      </p>
      {verifying && (
        <Modal
          className="account-security-dialog"
          title="身份验证"
          close={() => setVerifying(false)}
        >
          <IdentityVerification
            account={account}
            done={async () => {
              await saved();
              setVerifying(false);
              setEditing(true);
            }}
          />
        </Modal>
      )}
      {editing && <p className="auth-note">3–32 位字母、数字、下划线或连字符，全站唯一。</p>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
