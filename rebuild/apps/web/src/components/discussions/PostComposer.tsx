'use client';

import { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { DiscussionForm } from './DiscussionActions';
import type { Community } from '../../lib/api';

export function PostComposer() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [boards, setBoards] = useState<Community[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function open() {
    dialog.current?.showModal();
    if (boards) return;
    setFailed(false);
    try {
      const result = await fetch('/api/backend/communities', { cache: 'no-store' });
      if (!result.ok) throw new Error('COMMUNITIES_UNAVAILABLE');
      setBoards(await result.json() as Community[]);
    } catch {
      setFailed(true);
    }
  }
  return <>
    <button type="button" className="demo-publish" onClick={() => void open()}><Plus />发帖</button>
    <dialog ref={dialog} className="demo-composer" aria-labelledby="demo-composer-title">
      <header><h2 id="demo-composer-title">发帖</h2>
        <button type="button" aria-label="关闭发帖器" onClick={() => dialog.current?.close()}><X /></button>
      </header>
      {boards?.length ? <DiscussionForm boards={boards} /> : <p role="status">
        {failed ? '暂时无法加载板块，关闭后可以重试。' : boards ? '当前没有可发帖的板块。' : '正在加载板块…'}
      </p>}
    </dialog>
  </>;
}
