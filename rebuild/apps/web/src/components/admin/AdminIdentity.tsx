'use client';
import { useEffect, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { DemoAuthDialog, switchAccount } from '../DemoAuthDialog';
import { useInitialActor } from '../../lib/initial-actor';

export function AdminIdentity({ role }: { role: string }) {
  const actor = useInitialActor();
  const [name, setName] = useState(actor?.nickname || '');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/session/me', { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const actor = await response.json();
      if (!controller.signal.aborted) setName(actor.nickname || actor.userId);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  return <div className="admin-identity">
    <span><strong>{name || (failed ? '身份加载失败' : '加载身份…')}</strong><small>{role}</small></span>
    <button id="admin-switch-account" type="button" onClick={switchAccount} disabled={!name}><ArrowRightLeft size={16} />切换账号</button>
    <DemoAuthDialog currentAccount={name} />
  </div>;
}
