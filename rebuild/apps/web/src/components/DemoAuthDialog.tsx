'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { accountRequest } from './community/account-client';

import { prepareAccountChange, finishAccountChange, cancelAccountChange } from '../lib/browser-session';
type Mode = 'password' | 'code' | 'register' | 'recovery';
export function switchAccount() {
  window.dispatchEvent(new Event('umeet:accounts'));
}

export function DemoAuthDialog({ registrationMode, currentAccount }: { registrationMode?: 'open' | 'invite' | 'campus' | undefined; currentAccount?: string } = {}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('password');
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [message, setMessage] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; recipient: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const newPassword = mode === 'register' || mode === 'recovery';
  useEffect(() => {
    const open = (event: Event) => {
      const switching = event instanceof CustomEvent && event.detail?.switchAccount === true;
      setSwitchingAccount(switching);
      returnFocus.current = event instanceof CustomEvent && event.detail?.trigger instanceof HTMLElement
        ? event.detail.trigger : document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setMessage('');
      if (switching) {
        setMode('password');
        setEmail('');
        setUsername(event instanceof CustomEvent && typeof event.detail?.username === 'string' ? event.detail.username : '');
        setPassword('');
        setRepeat('');
        setCode('');
        setInviteCode('');
        setChallenge(null);
      }
      if (event instanceof CustomEvent && typeof event.detail === 'string')
        setMessage(event.detail);
      if (!dialog.current?.open) dialog.current?.showModal();
      requestAnimationFrame(() => usernameInput.current?.focus());
    };
    window.addEventListener('umeet:login', open);
    return () => window.removeEventListener('umeet:login', open);
  }, []);
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil((cooldown - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);
  function switchMode(next: Mode) {
    setMode(next);
    setMessage('');
    setChallenge(null);
    setCode('');
    setInviteCode('');
    setPassword('');
    setRepeat('');
    requestAnimationFrame(() => (next === 'password' || next === 'register' ? usernameInput.current : emailInput.current)?.focus());
  }
  async function requestCode() {
    if (busy || seconds > 0 || !emailInput.current?.reportValidity()) return;
    setBusy(true);
    setMessage('');
    try {
      const data = (await accountRequest('/api/verification/request', {
        channel: 'email',
        recipient: email.trim(),
        purpose: mode === 'register' ? 'register' : mode === 'recovery' ? 'recovery' : 'login',
      })) as { challengeId: string; resendAfterSeconds: number };
      setChallenge({ id: data.challengeId, recipient: email.trim() });
      setCooldown(Date.now() + data.resendAfterSeconds * 1000);
      setMessage(
        mode === 'recovery'
          ? '如果邮箱已绑定账号，验证码将发送到该邮箱'
          : '验证码已发送，请查收邮箱',
      );
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (newPassword && password !== repeat) {
      setMessage('两次输入的密码不同，请检查');
      return;
    }
    if (mode !== 'password' && (!challenge || challenge.recipient !== email.trim())) {
      setMessage('请先为当前邮箱获取验证码');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await prepareAccountChange();
      if (mode === 'password') await accountRequest('/api/session/login', { username, password });
      else
        await accountRequest('/api/verification/' + (mode === 'code' ? 'login' : mode), {
          challengeId: challenge!.id,
          code: code.trim(),
          ...(newPassword ? { password } : {}),
          ...(mode === 'register' ? { username, ...(inviteCode.trim() ? { inviteCode: inviteCode.trim().toLowerCase() } : {}) } : {}),
        });

      if (switchingAccount) { try { sessionStorage.setItem('umeet-account-switched', '1'); } catch { /* Login still succeeds when storage is unavailable. */ } }
      dialog.current?.close();
      finishAccountChange();
    } catch (failure) {
      cancelAccountChange();
      setMessage(failure instanceof Error ? failure.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={dialog} id="umeet-auth-dialog" className="auth-modal" aria-labelledby="auth-title"
      onCancel={(event) => { if (busy) event.preventDefault(); }}
      onClose={() => {
        setPassword(''); setRepeat(''); setCode('');
        const target = returnFocus.current;
        requestAnimationFrame(() => {
          if (target?.isConnected && target.getClientRects().length) target.focus();
          else document.getElementById('btn-avatar')?.focus();
        });
      }}>
      <header>
        <h2 id="auth-title">
          {mode === 'register' ? '注册 Umeet' : mode === 'recovery' ? '重设密码' : switchingAccount ? '添加账号' : '登录 Umeet'}
        </h2>
        <button
          type="button"
          id="auth-close"
          aria-label="关闭"
          disabled={busy}
          onClick={() => dialog.current?.close()}
        >
          ✕
        </button>
      </header>
      <form className="auth-body" id="auth-form" onSubmit={submit}>
        {switchingAccount && <div className="auth-current-account"><span>当前账号</span><strong>{currentAccount || '已登录账号'}</strong><p>登录后记住此账号，并同步切换所有 Umeet 标签页。</p></div>}
        <p id="auth-message" role="status" hidden={!message}>
          {message}
        </p>
        {(mode === 'password' || mode === 'register') && (
          <label>
            {mode === 'register' ? '用户名' : '邮箱或用户名'}
            <input
              id="auth-username"
              ref={usernameInput}
              type="text"
              autoComplete="username"
              required
              maxLength={mode === 'register' ? 32 : 254}
              minLength={mode === 'register' ? 3 : 1}
              pattern={mode === 'register' ? '[a-zA-Z0-9_][a-zA-Z0-9_\\-]{2,31}' : undefined}
              value={username}
              disabled={busy}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
        )}
        {mode === 'register' && registrationMode !== 'open' && registrationMode !== 'campus' && (
          <label>邀请码{!registrationMode && '（受邀时填写）'}
            <input autoComplete="off" value={inviteCode} maxLength={32} pattern="[a-fA-F0-9]{32}"
              required={registrationMode === 'invite'} onChange={(event) => setInviteCode(event.target.value)} />
          </label>
        )}
        {mode === 'register' && registrationMode === 'campus' && <p className="auth-note">请使用获准的校园邮箱注册。</p>}
        {mode === 'register' && (
          <p className="auth-note">
            用户名全站唯一，3–32 位字母、数字、下划线或连字符，注册后可修改一次。
          </p>
        )}
        {mode !== 'password' && (
          <>
            <label>
              邮箱
              <input
                ref={emailInput}
                type="email"
                id="auth-email"
                required
                autoComplete="email"
                maxLength={254}
                value={email}
                disabled={busy}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setChallenge(null);
                }}
              />
            </label>
            <button
              type="button"
              className="btn-ghost"
              id="auth-request"
              disabled={busy || seconds > 0}
              onClick={requestCode}
            >
              {seconds > 0 ? seconds + ' 秒后重发' : '获取验证码'}
            </button>
            <label>
              邮箱验证码
              <input
                type="text"
                id="auth-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoComplete="one-time-code"
                value={code}
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
          </>
        )}
        {mode !== 'code' && (
          <label>
            {newPassword ? '设置密码' : '密码'}
            <input
              id="auth-password"
              type="password"
              autoComplete={newPassword ? 'new-password' : 'current-password'}
              minLength={newPassword ? 12 : 1}
              maxLength={128}
              required
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}
        {newPassword && (
          <>
            <label>
              确认密码
              <input
                id="auth-password-repeat"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={repeat}
                disabled={busy}
                onChange={(event) => setRepeat(event.target.value)}
              />
            </label>
            <p className="auth-note">使用 12–128 个字符，支持长密码和空格。</p>
          </>
        )}
        {mode === 'code' && <p className="auth-note">使用已注册账号绑定的邮箱登录。</p>}
        {mode === 'recovery' && (
          <p className="auth-note">验证已绑定的邮箱后保存新密码，原有登录状态会失效。</p>
        )}
        <div className="auth-actions">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy
              ? '处理中…'
              : mode === 'register'
                ? '注册账号'
                : mode === 'recovery'
                  ? '重设密码'
                  : switchingAccount ? '登录并切换' : '登录'}
          </button>
          {switchingAccount && <button type="button" className="btn-ghost" disabled={busy} onClick={() => dialog.current?.close()}>取消切换</button>}
        </div>
        <div className="auth-methods">
          {mode !== 'password' && (
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              onClick={() => switchMode('password')}
            >
              密码登录
            </button>
          )}
          {mode !== 'code' && (
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              onClick={() => switchMode('code')}
            >
              邮箱验证码登录
            </button>
          )}
          {!switchingAccount && mode !== 'register' && (
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              onClick={() => switchMode('register')}
            >
              注册账号
            </button>
          )}
          {mode !== 'recovery' && (
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              onClick={() => { setSwitchingAccount(false); switchMode('recovery'); }}
            >
              忘记密码
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
