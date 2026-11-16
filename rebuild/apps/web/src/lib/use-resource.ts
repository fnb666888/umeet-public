'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ResourceDomain, resourceKey } from './resources';
/** Every module uses the same first-paint, refresh, cancellation and error rules. */
export function useResource<T>(domain: ResourceDomain, path: string | null, read: (path: string, signal: AbortSignal) => Promise<T>) {
  const key = path === null ? null : resourceKey(path);
  const loader = useRef(read); loader.current = read;
  const [result, setResult] = useState<{key:string|null;data:T|null;error:string;loading:boolean}>(() => ({key, data: key === null ? null : domain.peek<T>(key) ?? null, error: '', loading: key !== null && domain.peek(key) === undefined}));
  const [revision, setRevision] = useState(0);
  const currentKey = useRef(key); currentKey.current = key;
  const reload = useCallback(() => { if (currentKey.current !== null) domain.forget(currentKey.current); setRevision(v => v + 1); }, [domain]);
  useEffect(() => domain.subscribe(event => {
    const current = currentKey.current;
    if (event.key !== undefined && event.key !== current) return;
    if (event.type === 'invalidate') setRevision(v => v + 1);
    if (event.type === 'evict') setResult({key: current, data: null, error: '', loading: false});
    if (event.type === 'update' && current !== null) {
      const data = domain.peek<T>(current);
      if (data !== undefined) setResult({key: current, data, error:'', loading:false});
    }
  }), [domain]);
  useEffect(() => {
    if (key === null) { setResult({key, data:null, error:'', loading:false}); return; }
    const controller = new AbortController(), cached = domain.peek<T>(key);
    setResult(previous => { const data = cached ?? (previous.key === key ? previous.data : null); return {key, data, error:'', loading: data === null}; });
    void loader.current(key, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({key, data, error:'', loading:false});
    }).catch(error => {
      if (controller.signal.aborted) return;
      setResult(previous => ({key, data: [401,403,404].includes(error?.status) ? null : previous.key === key ? previous.data : null, error:error instanceof Error ? error.message : '读取失败，请重试', loading:false}));
    });
    return () => controller.abort();
  }, [domain, key, revision]);
  const changed = result.key !== key, data = changed ? (key === null ? null : domain.peek<T>(key) ?? null) : result.data;
  return {data, error:changed ? '' : result.error, loading:changed ? key !== null && data === null : result.loading, reload};
}
