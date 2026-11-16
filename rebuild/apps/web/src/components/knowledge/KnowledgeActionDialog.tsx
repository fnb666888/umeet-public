'use client';
import { useState, useEffect, useRef } from 'react';
import { failureMessage } from './knowledge-client';
export type KnowledgeAction = {
  title: string;
  description: string;
  confirm: string;
  destructive?: boolean;
  run: (reason: string) => Promise<void>;
};
export function KnowledgeActionDialog({
  action,
  onClose,
}: {
  action: KnowledgeAction | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    if (action) {
      setReason('');
      setError('');
      setAcknowledged(false);
      ref.current?.showModal();
    } else ref.current?.close();
  }, [action]);
  return (
    <dialog
      ref={ref}
      className="knowledge-dialog"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
      aria-labelledby="knowledge-action-title"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!action) return;
          setBusy(true);
          setError('');
          try {
            await action.run(reason);
            onClose();
          } catch (e) {
            setError(failureMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="knowledge-action-title">{action?.title}</h2>
        <p>{action?.description}</p>
        <label>
          处理理由与依据
          <textarea
            aria-label="处理理由与依据"
            disabled={busy}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={4000}
            rows={4}
          />
        </label>
        {action?.destructive && (
          <label className="knowledge-checkbox">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            我理解此操作不可恢复，并已核对影响范围。
          </label>
        )}
        {error && (
          <p role="alert" className="knowledge-danger">
            {error}
          </p>
        )}
        <div className="knowledge-actions">
          <button className="knowledge-button" type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className={
              'knowledge-button ' +
              (action?.destructive ? 'knowledge-destructive' : 'knowledge-primary')
            }
            disabled={busy || (!!action?.destructive && !acknowledged)}
          >
            {busy ? '正在处理…' : action?.confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}
