'use client';
import { useResource } from '../../lib/use-resource';
import { dispositionRequest, dispositionResources } from './disposition-client';
import { logout } from './Profile';
import { useState } from 'react';
import type { AccountOverview } from '../../../../../packages/contracts/src/account';
import type { GovernanceStatus } from '../../../../../packages/contracts/src/admin';
import { accountRequest } from './account-client';
import { DispositionEffects } from '../DispositionEffects';
import { IdentityVerification } from './IdentityVerification';

export function AccountDispositionPage() {
  const resource = useResource<GovernanceStatus>(dispositionResources, '', () => dispositionRequest<GovernanceStatus>());
  const status = resource.data;
  const [account, setAccount] = useState<AccountOverview | null>(null);
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [verified, setVerified] = useState(false);
  return (
    <main className="account-disposition-page">
      <h1>{status?.suspended ? '账号已停用' : '处置与申诉'}</h1>
      {status?.suspended && <p>可在此查看处置原因和期限，并提交申诉。</p>}
      {(error || resource.error) && <p role="alert">{error || resource.error}</p>}
      {!status && !error && !resource.error && <p>正在加载…</p>}
      {status?.actions.map((action) => (
        <article key={action.id}>
          <h2>{action.title}</h2>
          <p>{action.reason}</p>
          <small>
            {new Date(action.createdAt).toLocaleString('zh-CN')}
            {action.until ? ' · 到期 ' + new Date(action.until).toLocaleString('zh-CN') : ''}
          </small>
          {!!action.effects?.length && <DispositionEffects effects={action.effects} />}
          {action.appeal ? (
            <p>
              申诉进度 ·{' '}
              {(
                {
                  pending: '待复核',
                  upheld: '维持处置',
                  reversed: '已撤销',
                  partial: '部分撤销',
                } as Record<string, string>
              )[action.appeal.status] || action.appeal.status}{' '}
              {action.appeal.resolution}
            </p>
          ) : (
            <button
              onClick={() => {
                setSelected(action.actionId!);
                setReason('');
              }}
            >
              提交申诉
            </button>
          )}
          {selected === action.actionId && !action.appeal && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                try {
                  await accountRequest('/api/backend/governance/appeals', {
                    actionId: selected,
                    reason,
                  });
                  setSelected('');
                  resource.reload();
                } catch (failure) {
                  setError((failure as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                申诉说明
                <textarea
                  required
                  minLength={2}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <button disabled={busy}>提交复核</button>
              <button type="button" onClick={() => setSelected('')}>
                取消
              </button>
            </form>
          )}
        </article>
      ))}
      <section>
        <h2>账号安全</h2>
        <button
          onClick={async () => {
            try {
              setAccount((await accountRequest('/api/backend/account')) as AccountOverview);
            } catch (failure) {
              setError((failure as Error).message);
            }
          }}
        >
          查看登录设备
        </button>
        {account && !verified && (
          <IdentityVerification
            account={account}
            done={async () => {
              setVerified(true);
              setError('');
            }}
          />
        )}
        {verified && <p role="status">身份已验证，可以退出其他设备</p>}
        {account?.sessions.map((session) => (
          <p key={session.id}>
            <span title={session.device}>
              {session.device.includes('Edg/')
                ? 'Edge 浏览器'
                : session.device.includes('Chrome/')
                  ? 'Chrome 浏览器'
                  : session.device.includes('Firefox/')
                    ? 'Firefox 浏览器'
                    : session.device.includes('Safari/')
                      ? 'Safari 浏览器'
                      : '登录设备'}
            </span>{' '}
            {session.current ? (
              '当前设备'
            ) : (
              <button
                onClick={async () => {
                  try {
                    await accountRequest('/api/backend/account/revoke', { id: session.id });
                    setAccount((await accountRequest('/api/backend/account')) as AccountOverview);
                  } catch (failure) {
                    setError((failure as Error).message);
                  }
                }}
              >
                退出此设备
              </button>
            )}
          </p>
        ))}
      </section>
      <p>
        {status && !status.suspended && <a href="/">返回社区</a>}{' '}
        <button
          onClick={async () => {
            try { await logout(); } catch (failure) { setError((failure as Error).message); }
          }}
        >
          退出登录
        </button>
      </p>
    </main>
  );
}
