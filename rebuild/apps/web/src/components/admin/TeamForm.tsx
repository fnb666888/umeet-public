'use client';
import { useRef, useState } from 'react';
import { adminRequest } from './admin-api';

export function TeamForm({
  board,
  onComplete,
}: {
  board: string;
  onComplete: () => void;
}) {
  const [username, setUsername] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  return (
    <form
      className="admin-confirm"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          const payload = {
            action: 'member.role',
            target: username.trim(),
            role: 'moderator',
            reason: reason.trim(),
          };
          const fingerprint = JSON.stringify({ ...payload, board });
          if (pending.current?.fingerprint !== fingerprint)
            pending.current = { fingerprint, id: crypto.randomUUID() };
          await adminRequest('actions?board=' + board, { ...payload, id: pending.current.id });
          setUsername('');
          setReason('');
          pending.current = null;
          onComplete();
        } catch (error) {
          setError((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>添加版主</h2>
      <label>
        用户名
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
          maxLength={64}
          disabled={busy}
        />
      </label>
      <label>
        授权原因
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          minLength={2}
          maxLength={500}
          disabled={busy}
        />
      </label>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      <button className="admin-primary" disabled={busy}>
        {busy ? '正在授权…' : '确认授权'}
      </button>
    </form>
  );
}
