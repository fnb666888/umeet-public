import { Suspense } from 'react';
import { KnowledgeComposer } from '../../../../components/knowledge/KnowledgeComposer';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<p>正在准备编辑器…</p>}>
      <KnowledgeComposer pageId={id} />
    </Suspense>
  );
}
