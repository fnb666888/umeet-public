'use client';
import { useEffect, useState } from 'react';
import { useUnsavedSettings } from './use-unsaved-settings';
import { governanceRequest, cachedGovernance } from '../community/governance-client';
type Settings = { version: number; description: string; rules: string[] };
export function CommunityBoardSettings({ board }: { board: string }) {
  const [value, setValue] = useState<Settings | null>(() => cachedGovernance<Settings>('board-settings?board=' + board) ?? null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useUnsavedSettings(dirty, busy, '板块设置');
  useEffect(() => {
    if (!board) return;
    setMessage('');
    setValue(cachedGovernance<Settings>('board-settings?board=' + board) ?? null);
    setDirty(false);
    void governanceRequest<Settings>('board-settings?board=' + board)
      .then(setValue)
      .catch((error) => { setValue(null); setMessage(error.message); });
  }, [board]);
  return (
    <section data-account-draft-safe>
      <h2>板块设置</h2>
      {message && <p role="status">{message}</p>}
      {value && (
        <form
          className="governance-form"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            void governanceRequest<Settings>('board-settings', {
              board,
              version: value.version,
              description: value.description,
              rules: value.rules.map((rule) => rule.trim()).filter(Boolean),
            })
              .then((result) => {
                setValue(result);
                setDirty(false);
                setMessage('已保存');
              })
              .catch((error) => setMessage(error.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            板块简介
            <textarea
              required
              maxLength={160}
              value={value.description}
              onChange={(event) => {
                setValue({ ...value, description: event.target.value });
                setDirty(true);
              }}
            />
          </label>
          <label>
            基本规则，每行一条
            <textarea
              value={value.rules.join(String.fromCharCode(10))}
              onChange={(event) => {
                setValue({ ...value, rules: event.target.value.split(String.fromCharCode(10)) });
                setDirty(true);
              }}
            />
          </label>
          <button disabled={busy || !dirty}>保存更改</button>
        </form>
      )}
    </section>
  );
}
