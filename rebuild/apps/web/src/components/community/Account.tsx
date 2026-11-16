'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  AccountOverviewSchema,
  OtpChallengeSchema,
  type AccountOverview,
} from '../../../../../packages/contracts/src/index';
import { useCommunity } from './store';
import { Modal } from './Wiki';
import { logout } from './Profile';
import { switchAccount } from '../DemoAuthDialog';
import { AccountPassword, AccountClosure } from './AccountSecurity';

import { UsernameEditor } from './UsernameEditor';
import { accountRequest, accountResources } from './account-client';
import { useResource } from '../../lib/use-resource';
import { IdentityVerification, PasswordVerification, maskEmail } from './IdentityVerification';
export function useAccount() {
  const resource = useResource<AccountOverview>(accountResources, '/api/backend/account', async path => AccountOverviewSchema.parse(await accountRequest(path)));
  const load = useCallback(async () => { resource.reload(); }, [resource.reload]);
  useEffect(() => {
    const update = () => {
      void load();
    };
    window.addEventListener('umeet:account-updated', update);
    return () => window.removeEventListener('umeet:account-updated', update);
  }, [load]);
  return { account: resource.data, error: resource.error, load };
}
function LinkEmail({ done }: { done: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!seconds) return;
    const timer = window.setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);
  async function send() {
    if (busy || seconds || !email) return;
    setBusy(true);
    setMessage('');
    try {
      const result = OtpChallengeSchema.parse(
        await accountRequest('/api/verification/request', {
          channel: 'email',
          recipient: email.trim(),
          purpose: 'link',
        }),
      );
      setChallenge(result.challengeId);
      setSeconds(result.resendAfterSeconds);
      setMessage('验证码已发送，请查收新邮箱');
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="account-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !challenge) return;
        setBusy(true);
        setMessage('');
        try {
          await accountRequest('/api/verification/link', { challengeId: challenge, code });
          await done();
        } catch (failure) {
          setMessage(failure instanceof Error ? failure.message : '绑定失败');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="auth-note">验证新邮箱后即可用它登录。原邮箱可在绑定成功后移除。</p>
      <label>
        新邮箱
        <input
          id="account-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          disabled={busy}
          onChange={(event) => {
            setEmail(event.target.value);
            setChallenge(null);
          }}
        />
      </label>
      <div className="verification-code-row">
        <input
          id="account-link-code"
          aria-label="新邮箱验证码"
          placeholder="输入 6 位邮箱验证码"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          disabled={busy}
          onChange={(event) => setCode(event.target.value)}
        />
        <button
          type="button"
          className="link-btn"
          disabled={busy || seconds > 0 || !email}
          onClick={() => {
            const input = document.getElementById('account-email');
            if (input instanceof HTMLInputElement && input.reportValidity()) void send();
          }}
        >
          {seconds > 0 ? seconds + ' 秒后重发' : '获取验证码'}
        </button>
      </div>
      <p role="status">{message}</p>
      <button className="btn-primary" disabled={busy || !challenge || !/^\d{6}$/.test(code)}>
        保存邮箱
      </button>
    </form>
  );
}
type AccountAction = 'link' | 'close' | 'password' | { unlink: string };
export function AccountCenter() {
  const { account, error, load } = useAccount();
  const { toast } = useCommunity();
  const [action, setAction] = useState<AccountAction | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  function open(next: AccountAction) {
    setVerified(false);
    setAction(next);
  }
  async function unlink(key: string) {
    setBusy(true);
    try {
      await accountRequest('/api/backend/account/unlink', { key });
      await load();
      setAction(null);
      toast('登录方式已移除');
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : '移除失败');
    } finally {
      setBusy(false);
    }
  }
  async function identityVerified() {
    await load();
    if (action && typeof action === 'object') await unlink(action.unlink);
    else setVerified(true);
  }
  if (!account)
    return (
      <div className="empty">
        <p>{error || '正在加载账号…'}</p>
        {error && <button onClick={() => void load()}>重试</button>}
      </div>
    );
  const emails = account.identities.filter((identity) => identity.email);
  const others = account.identities.filter((identity) => !identity.email);
  return (
    <div className="account-settings">
      {error && <p role="alert">{error}</p>}
      <section className="account-section" aria-labelledby="account-settings-title">
        <header className="account-section-heading">
          <h2 id="account-settings-title">账号设置</h2>
          <p>管理用户名、邮箱与登录密码。</p>
          <p>修改安全设置时需要验证身份。</p>
        </header>
        <div className="account-setting-row username-setting">
          <div className="account-setting-label">用户名</div>
          <UsernameEditor account={account} saved={load} />
        </div>
        <div className="account-setting-row">
          <div>
            <h3>密码</h3>
            <p>{account.hasPassword ? '已设置' : '未设置'}</p>
          </div>
          <button className="link-btn" aria-label="编辑密码" onClick={() => open('password')}>
            编辑
          </button>
        </div>
        {emails.map((identity) => (
          <div className="account-setting-row" key={identity.key}>
            <div>
              <h3>绑定邮箱</h3>
              <p>{maskEmail(identity.email!)}</p>
            </div>
            <div className="account-row-actions">
              <button
                className="link-btn"
                aria-label={'编辑邮箱 ' + maskEmail(identity.email!)}
                onClick={() => open('link')}
              >
                编辑
              </button>
              {emails.length > 1 && (
                <button
                  className="link-btn"
                  disabled={busy}
                  onClick={() => {
                    if (confirm('确认移除此邮箱？其他设备将退出登录。'))
                      open({ unlink: identity.key });
                  }}
                >
                  移除
                </button>
              )}
            </div>
          </div>
        ))}
        {!emails.length && (
          <div className="account-setting-row">
            <div>
              <h3>绑定邮箱</h3>
              <p>未绑定</p>
            </div>
            <button className="link-btn" onClick={() => open('link')}>
              绑定
            </button>
          </div>
        )}
        {others.length > 0 && (
          <div className="account-third-party">
            <h3>第三方账号</h3>
            {others.map((identity) => (
              <div className="account-setting-row" key={identity.key}>
                <div>
                  <h3>{identity.provider === 'wechat' ? '微信' : identity.provider}</h3>
                  <p>{identity.label}</p>
                </div>
                <button
                  className="link-btn"
                  disabled={busy}
                  onClick={() => {
                    if (confirm('确认解除绑定？')) open({ unlink: identity.key });
                  }}
                >
                  解除绑定
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="account-section account-danger">
        <div className="account-setting-row">
          <div>
            <h3>注销账号</h3>
            <p>永久删除登录凭据和私人资料，无法恢复。公开贡献保留为已注销用户。</p>
          </div>
          <button className="link-btn danger-action" onClick={() => open('close')}>
            注销
          </button>
        </div>
      </section>
      <div className="account-session-actions"><button className="btn-ghost" onClick={switchAccount}>
        切换账号
      </button>
      <button
        className="btn-ghost"
        onClick={() => void logout().catch((failure) => toast(failure.message))}
      >
        退出当前账号
      </button>
      </div>
      {action && (
        <Modal
          className="account-security-dialog"
          title={
            action === 'password'
              ? verified
                ? '修改密码'
                : '身份验证'
              : !verified
                ? '身份验证'
                : action === 'link'
                  ? '更换邮箱'
                  : '注销账号'
          }
          close={() => setAction(null)}
        >
          {action === 'password' ? (
            <AccountPassword
              account={account}
              verified={setVerified}
              done={async () => {
                await load();
                setAction(null);
                toast('密码已更新，其他设备已退出');
              }}
            />
          ) : !verified ? (
            emails.length ? (
              <IdentityVerification account={account} done={identityVerified} />
            ) : account.hasPassword ? (
              <PasswordVerification done={identityVerified} />
            ) : (
              <p>请通过已绑定的微信重新登录后继续。</p>
            )
          ) : action === 'link' ? (
            <LinkEmail
              done={async () => {
                await load();
                setAction(null);
                toast('邮箱已绑定');
              }}
            />
          ) : action === 'close' ? (
            <AccountClosure accountName={account.handle || account.nickname} />
          ) : null}
        </Modal>
      )}
    </div>
  );
}
