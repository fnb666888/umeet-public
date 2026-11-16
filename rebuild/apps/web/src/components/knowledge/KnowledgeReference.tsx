'use client';
import { SiteLink as Link } from '../SiteLink';
import type { ReactNode } from 'react';
import type { KnowledgePage } from '../../../../../packages/contracts/src/knowledge';
import { useKnowledge } from './useKnowledge';
export function KnowledgeReference({
  pageId,
  href,
  children,
}: {
  pageId: string;
  href: string;
  children: ReactNode;
}) {
  const r = useKnowledge<KnowledgePage>('pages/' + pageId);
  return r.error ? (
    <span className="knowledge-muted" aria-disabled="true">
      {children}（词条不可用）
    </span>
  ) : (
    <Link href={href}>{children}</Link>
  );
}
