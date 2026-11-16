import { useEffect } from 'react';
import type { Reply } from './model';

type ReadingRecord = { y: number; seen: string[] };
export function readRecord(key: string): ReadingRecord | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || 'null');
    if (
      !value ||
      typeof value !== 'object' ||
      !('y' in value) ||
      typeof value.y !== 'number' ||
      !('seen' in value) ||
      !Array.isArray(value.seen)
    )
      return null;
    return { y: value.y, seen: value.seen.filter((id): id is string => typeof id === 'string') };
  } catch {
    return null;
  }
}
export function useReading(key: string, replies: Reply[], anchor: string, thread: string | null) {
  useEffect(() => {
    const record = readRecord(key) || { y: 0, seen: replies.map((reply) => reply.id) };
    const seen = new Set(record.seen);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let storageFailed = false;
    const save = () => {
      if (storageFailed) return;
      try {
        localStorage.setItem(key, JSON.stringify(record));
      } catch {
        storageFailed = true;
      }
    };
    const update = () => {
      document.querySelectorAll<HTMLElement>('#cmts .comment').forEach((element) => {
        const bounds = element.getBoundingClientRect();
        if (bounds.top >= 62 && bounds.top < innerHeight - 80) seen.add(element.id.slice(3));
      });
      record.seen = [...seen];
      if (!thread) record.y = window.scrollY;
      clearTimeout(timer);
      timer = setTimeout(save, 160);
    };
    const frame = requestAnimationFrame(() => {
      if (!anchor && !thread) window.scrollTo({ top: record.y, behavior: 'instant' });
      update();
    });
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('pagehide', save);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener('scroll', update);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [key, anchor, thread]);
}
