import { KnowledgeArticle } from '../../../components/knowledge/KnowledgeArticle';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <KnowledgeArticle pageId={id} />;
}
