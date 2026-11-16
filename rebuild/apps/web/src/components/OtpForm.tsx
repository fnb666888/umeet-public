'use client';
import { useEffect, useState, type FormEvent } from 'react';
import {
  ClientAuthResultSchema,
  OtpChallengeSchema,
  type OtpChallenge,
  type Actor,
} from '../../../../packages/contracts/src/index';
import { authError } from '../lib/auth-errors';
import { humanVerification } from '../lib/turnstile-client';
export function OtpForm({
  channel,
  purpose,
  onAuthenticated,
  onLinked,
  onBusyChange,
}: {
  channel: 'email' | 'sms';
  purpose: 'login' | 'link';
  onAuthenticated?: (actor: Actor) => void;
  onLinked?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [recipient, setRecipient] = useState(''),
    [code, setCode] = useState(''),
    [challenge, setChallenge] = useState<OtpChallenge | null>(null),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [retryAt, setRetryAt] = useState(0),
    [now, setNow] = useState(0);
  useEffect(() => {
    if (!retryAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));
  function working(value: boolean) {
    setBusy(value);
    onBusyChange?.(value);
  }
  async function requestCode() {
    working(true);
    setError('');
    setStatus('正在发送验证码…');
    try {
      const response = await fetch('/api/verification/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, recipient, purpose, turnstileToken: await humanVerification() }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        if (
          data &&
          typeof data === 'object' &&
          'retryAfterSeconds' in data &&
          typeof data.retryAfterSeconds === 'number' &&
          data.retryAfterSeconds > 0 &&
          data.retryAfterSeconds <= 60
        ) {
          setNow(Date.now());
          setRetryAt(Date.now() + data.retryAfterSeconds * 1000);
        }
        throw new Error(authError(data));
      }
      const parsed = OtpChallengeSchema.safeParse(data);
      if (!parsed.success) throw new Error('验证码服务响应无效，请稍后重试。');
      setChallenge(parsed.data);
      setCode('');
      setNow(Date.now());
      setRetryAt(Date.now() + parsed.data.resendAfterSeconds * 1000);
      setStatus(
        channel === 'email'
          ? '请检查邮箱中的验证码，10 分钟内有效。'
          : '请检查短信中的验证码，10 分钟内有效。',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送未完成，请重试。');
      setStatus('');
    } finally {
      working(false);
    }
  }
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    working(true);
    setError('');
    setStatus('正在验证…');
    try {
      const response = await fetch('/api/verification/' + (purpose === 'link' ? 'link' : 'login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: challenge.challengeId, code }),
      });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(authError(data));
      setCode('');
      setChallenge(null);
      setStatus(purpose === 'link' ? '已绑定这个登录方式。' : '验证成功。');
      if (purpose === 'link') onLinked?.();
      else {
        const result = ClientAuthResultSchema.safeParse(data);
        if (!result.success) throw new Error('认证响应无效，请重试。');
        onAuthenticated?.(result.data.actor);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '验证未完成，请重试。');
      setStatus('');
    } finally {
      working(false);
    }
  }
  return (
    <form className="otp-form" onSubmit={(event) => void verify(event)}>
      <label>
        {channel === 'email' ? '邮箱地址' : '手机号'}
        <input
          aria-label={channel === 'email' ? '邮箱地址' : '手机号'}
          type={channel === 'email' ? 'email' : 'tel'}
          autoComplete={channel === 'email' ? 'email' : 'tel'}
          value={recipient}
          disabled={busy}
          onChange={(event) => {
            setRecipient(event.target.value);
            setChallenge(null);
            setCode('');
          }}
          maxLength={254}
          placeholder={channel === 'email' ? 'name@example.com' : '+8613800000000'}
          required
        />
      </label>
      <button
        type="button"
        className="guest-button"
        disabled={busy || !recipient.trim() || remaining > 0}
        onClick={() => void requestCode()}
      >
        {remaining > 0 ? remaining + ' 秒后可重发' : challenge ? '重新获取验证码' : '获取验证码'}
      </button>
      {challenge && (
        <label>
          {channel === 'email' ? '邮箱验证码' : '短信验证码'}
          <input
            aria-label={channel === 'email' ? '邮箱验证码' : '短信验证码'}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            disabled={busy}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p role="status" className="muted">
        {status}
      </p>
      <button className="primary full" disabled={busy || !challenge || code.length !== 6}>
        {busy ? '正在处理…' : purpose === 'link' ? '确认绑定' : '继续登录 / 注册'}
      </button>
      {purpose === 'login' && (
        <p className="auth-note">
          请使用已注册账号绑定的邮箱或手机号。你可以在账号设置中绑定其他登录方式。
        </p>
      )}
    </form>
  );
}
