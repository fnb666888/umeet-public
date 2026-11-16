'use client';
import { useEffect } from 'react';

export function confirmSettingsLeave() {
  return window.dispatchEvent(new Event('umeet:settings-leave', { cancelable: true }));
}

export function useUnsavedSettings(dirty: boolean, busy: boolean, label = '站点设置') {
  useEffect(() => {
    if (!dirty && !busy) return;
    let leaving = false;
    const allow = () => !busy && window.confirm(label + '有未保存的更改。离开会放弃未保存的内容，确定离开？');
    const request = (event: Event) => { if (!allow()) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { if (!leaving) { event.preventDefault(); event.returnValue = ''; } };
    const sessionChanged = () => { leaving = true; };
    const origin = location.href;
    const popstate = (event: PopStateEvent) => {
      if (!allow()) { history.pushState(null, '', origin); event.stopImmediatePropagation(); }
    };
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && !link.hasAttribute('download') && link.getAttribute('target') !== '_blank') {
        if (!allow()) { event.preventDefault(); event.stopPropagation(); }
        else leaving = true;
      }
    };
    window.addEventListener('umeet:settings-leave', request);
    window.addEventListener('umeet:before-account-change', request);
    window.addEventListener('beforeunload', unload);
    window.addEventListener('umeet:session-changed', sessionChanged);
    window.addEventListener('popstate', popstate, true);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('umeet:settings-leave', request);
      window.removeEventListener('umeet:before-account-change', request);
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('umeet:session-changed', sessionChanged);
      window.removeEventListener('popstate', popstate, true);
      document.removeEventListener('click', click, true);
    };
  }, [dirty, busy, label]);
}
