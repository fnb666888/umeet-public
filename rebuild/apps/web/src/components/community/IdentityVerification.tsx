'use client';
import { useEffect, useState, type FormEvent } from 'react';
import {
  OtpChallengeSchema,
  type AccountOverview,
} from '../../../../../packages/contracts/src/index';
import { accountRequest } from './account-client';

export type EmailProof = { challengeId: string; code: string };
export function maskEmail(email: string) {
  const [name = '', domain = ''] = email.split('@');
  return name.slice(0, Math.min(2, name.length)) + '****@' + domain;
}
export function IdentityVerification({
  account,
  purpose = 'reauth',
  done,
}: {
  account: AccountOverview;
  purpose?: 'reauth' | 'password';
  done: (proof: EmailProof) => Promise<void>;
}) {
  const emails = account.identities.filter((identity) => identity.email);
  const [email, setEmail] = useState(emails[0]?.email || '');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil((cooldown - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);
  async function requestCode() {
    if (busy || seconds > 0 || !email) return;
    setBusy(true);
    setMessage('');
    try {
      const result = OtpChallengeSchema.parse(
        await accountRequest('/api/verification/request', {
          channel: 'email',
          recipient: email,
          purpose,
        }),
      );
      setChallenge(result.challengeId);
      setCode('');
      setCooldown(Date.now() + result.resendAfterSeconds * 1000);
      setMessage('验证码已发送，请查收邮箱');
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy || !challenge || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setMessage('');
    try {
      const proof = { challengeId: challenge, code };
      await accountRequest(
        '/api/verification/' + (purpose === 'password' ? 'password-check' : 'reauth'),
        proof,
      );
      await done(proof);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : '验证失败');
    } finally {
      setBusy(false);
    }
  }
  if (!emails.length)
    return purpose === 'reauth' && account.hasPassword ? (
      <PasswordVerification done={() => done({ challengeId: '', code: '' })} />
    ) : (
      <p>请先绑定邮箱后继续操作。</p>
    );
  return (
    <form className="identity-verification" onSubmit={verify}>
      <p className="verification-intro">
        为了保护你的账号安全，请验证身份，
        <br />
        验证成功后进行下一步操作
      </p>
      <div className="verification-recipient">
        {emails.length === 1 ? (
          <p>使用邮箱 {maskEmail(email)} 验证</p>
        ) : (
          <label>
            验证邮箱
            <select
              aria-label="验证邮箱"
              value={email}
              disabled={busy}
              onChange={(event) => {
                setEmail(event.target.value);
                setChallenge(null);
                setCode('');
                setMessage('');
              }}
            >
              {emails.map((identity) => (
                <option key={identity.key} value={identity.email}>
                  {maskEmail(identity.email!)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="verification-code-row">
        <input
          id="account-code"
          aria-label="邮箱验证码"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="输入 6 位邮箱验证码"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          disabled={busy}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <button
          id="account-code-request"
          type="button"
          className="link-btn"
          disabled={busy || seconds > 0}
          onClick={() => void requestCode()}
        >
          {seconds > 0 ? seconds + ' 秒后重发' : '获取验证码'}
        </button>
      </div>
      <p className="verification-message" role="status">
        {message}
      </p>
      <button
        className="btn-primary verification-submit"
        type="submit"
        disabled={busy || !challenge || !/^\d{6}$/.test(code)}
      >
        {busy ? '验证中…' : '验证'}
      </button>
    </form>
  );
}

export function PasswordVerification({ done }: { done: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await accountRequest('/api/session/reauth', { password });
      await done();
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : '验证失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="account-form" onSubmit={submit}>
      <label>
        当前密码
        <input
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          disabled={busy}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <p role="status">{message}</p>
      <button className="btn-primary" disabled={busy}>
        确认身份
      </button>
    </form>
  );
}
