'use client';
import { useEffect } from 'react';
import { useResource } from '../../lib/use-resource';
import type { KnowledgeCapabilities } from '../../../../../packages/contracts/src/knowledge';
import { readKnowledge, knowledgeResources, emptyCapabilities } from './knowledge-client';
export function useKnowledge<T>(path: string) {
  return useResource<T>(knowledgeResources, path, (key, signal) => readKnowledge<T>(key, signal));
}
export function useKnowledgeCapabilities(communityId?: string) {
  const resource = useKnowledge<KnowledgeCapabilities>(
    'capabilities' + (communityId ? '?communityId=' + encodeURIComponent(communityId) : ''),
  );
  useEffect(() => {
    const refresh = () => resource.reload();
    window.addEventListener('focus', refresh);
    window.addEventListener('umeet:auth-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('umeet:auth-changed', refresh);
    };
  }, [resource.reload]);
  return { ...resource, cap: resource.data ?? emptyCapabilities };
}
