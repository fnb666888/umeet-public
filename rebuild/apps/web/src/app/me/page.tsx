import { PersonalRecords } from '../../components/PersonalRecords';

export default async function RecordsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const bookmarks = (await searchParams).view === 'bookmark';
  return <>
    <header className="page-heading"><h1>{bookmarks ? '收藏' : '我的记录'}</h1><p>{bookmarks ? '回看你收藏的帖子和 Wiki 词条。' : '草稿、收藏和浏览记录随账号保留。'}</p><a className="text-link" href="/me/security">账号与登录</a></header>
    <PersonalRecords key={bookmarks ? 'bookmark' : 'draft'} initialKind={bookmarks ? 'bookmark' : 'draft'} />
  </>;
}
