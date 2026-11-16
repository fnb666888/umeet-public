import { notFound, redirect } from 'next/navigation';
import { apiUrl } from '../../../../../lib/api';
export const dynamic = 'force-dynamic';
export default async function ResolveWiki({
  params,
}: {
  params: Promise<{ slug: string; entry: string }>;
}) {
  const { slug, entry } = await params;
  const response = await fetch(
    apiUrl('/wiki/resolve/' + encodeURIComponent(slug) + '/' + encodeURIComponent(entry)),
    { cache: 'no-store', signal: AbortSignal.timeout(10000) },
  );
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('WIKI_UNAVAILABLE');
  const target = (await response.json()) as { id: string };
  redirect('/wiki/' + encodeURIComponent(target.id));
}
