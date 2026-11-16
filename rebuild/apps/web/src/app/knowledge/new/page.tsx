import { Suspense } from 'react';
import { KnowledgeComposer } from '../../../components/knowledge/KnowledgeComposer';
export default function Page() {
  return (
    <Suspense fallback={<p>正在准备编辑器…</p>}>
      <KnowledgeComposer />
    </Suspense>
  );
}
