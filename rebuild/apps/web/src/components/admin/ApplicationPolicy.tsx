'use client';
import { useEffect, useState } from 'react';
import { governanceRequest } from '../community/governance-client';
export function ApplicationPolicy() {
  const [value, setValue] = useState({ days: 30, posts: 5, version: 0 });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void governanceRequest<typeof value>('policy')
      .then(setValue)
      .catch((error) => setMessage(error.message));
  }, []);
  return (
    <section className="settings-panel">
      <h2>社区申请门槛</h2>
      <p>开设板块、成为版主和受邀成为助手共用以下条件。</p>
      {message && <p role="status">{message}</p>}
      <form
        className="governance-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void governanceRequest<typeof value>('policy', value)
            .then((result) => {
              setValue(result);
              setMessage('已保存');
            })
            .catch((error) => setMessage(error.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          注册天数
          <input
            type="number"
            min={0}
            max={3650}
            value={value.days}
            onChange={(event) => setValue({ ...value, days: Number(event.target.value) })}
          />
        </label>
        <label>
          有效发帖数
          <input
            type="number"
            min={0}
            max={10000}
            value={value.posts}
            onChange={(event) => setValue({ ...value, posts: Number(event.target.value) })}
          />
        </label>
        <button disabled={busy}>保存申请门槛</button>
      </form>
    </section>
  );
}
