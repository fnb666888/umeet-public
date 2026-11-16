'use client';
import { useState, type FormEvent } from 'react';
import type { AccountOverview } from '../../../../../packages/contracts/src/account';
import { prepareAccountChange, finishAccountChange, cancelAccountChange, setAccountState } from '../../lib/browser-session';
import type { BrowserAccountState } from '../../../../../packages/contracts/src/browser-accounts';
import { accountRequest } from './account-client';
import { IdentityVerification, type EmailProof } from './IdentityVerification';

export function AccountPassword({
  account,
  done,
  verified,
}: {
  account: AccountOverview;
  done: () => Promise<void>;
  verified: (value: boolean) => void;
}) {
  const [proof, setProof] = useState<EmailProof | null>(null);
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !proof) return;
    if (password !== repeat) {
      setMessage('两次输入的密码不同，请检查');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await prepareAccountChange();
      const result = await accountRequest('/api/verification/password', {
        ...proof,
        password,
        ...(account.hasPassword ? { currentPassword } : {}),
      }) as { state: BrowserAccountState };
      setAccountState(result.state);
      await done();
      finishAccountChange();
    } catch (failure) {
      cancelAccountChange();
      setMessage(failure instanceof Error ? failure.message : '密码保存失败');
    } finally {
      setBusy(false);
    }
  }
  if (!proof)
    return (
      <IdentityVerification
        account={account}
        purpose="password"
        done={async (value) => {
          setProof(value);
          verified(true);
        }}
      />
    );
  return (
    <form className="account-form" data-account-draft-safe onSubmit={submit}>
      <p className="auth-note">邮箱身份验证已通过。保存后其他设备将退出登录。</p>
      {account.hasPassword && (
        <label>
          原密码
          <input
            id="account-current-password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            disabled={busy}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
      )}
      <label>
        新密码
        <input
          id="account-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          disabled={busy}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <label>
        确认新密码
        <input
          id="account-password-repeat"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          disabled={busy}
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
        />
      </label>
      <p className="auth-note">使用 12–128 个字符，支持长密码和空格。</p>
      <p role="status">{message}</p>
      <button className="btn-primary" disabled={busy}>
        {busy ? '保存中…' : '保存新密码'}
      </button>
      <button
        className="link-btn"
        type="button"
        disabled={busy}
        onClick={() => {
          setProof(null);
          setMessage('');
          verified(false);
        }}
      >
        重新验证邮箱
      </button>
    </form>
  );
}
export function AccountClosure({ accountName }: { accountName?: string } = {}) {
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || confirmation !== '注销我的账号') return;
    setBusy(true);
    try {
      await prepareAccountChange();
      await accountRequest('/api/backend/account/close', { confirmation });
      finishAccountChange();
    } catch (failure) {
      cancelAccountChange();
      setMessage(failure instanceof Error ? failure.message : '注销未完成，请重试');
      setBusy(false);
    }
  }
  return (
    <form className="account-form" data-account-draft-safe onSubmit={submit}>
      {accountName && <p><strong>即将永久注销：{accountName}</strong></p>}
      <p>
        注销立即生效，账号将无法恢复。登录凭据、个人资料、收藏和私人记录会清除，全部设备退出登录。
      </p>
      <p>
        公开帖子、回复和 Wiki
        贡献会保留，作者显示为「已注销用户」。本人发送的私信替换为注销提示。用户名保留占位。
      </p>
      <label>
        输入「注销我的账号」以确认
        <input
          id="account-close-confirmation"
          required
          autoComplete="off"
          disabled={busy}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <p role="status">{message}</p>
      <button
        type="submit"
        className="btn-primary danger-action"
        disabled={busy || confirmation !== '注销我的账号'}
      >
        {busy ? '注销中…' : '确认永久注销'}
      </button>
    </form>
  );
}
