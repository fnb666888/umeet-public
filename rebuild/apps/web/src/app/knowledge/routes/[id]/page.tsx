import { LearningRoute } from '../../../../components/knowledge/LearningRoute';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LearningRoute routeId={id} />;
}
