import { CommunityKnowledge } from '../../../../components/knowledge/CommunityKnowledge';
import '../../../../components/knowledge/knowledge.css';
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CommunityKnowledge slug={slug} />;
}
