/** The same projection is used for SSR, navigation, prefetch and revalidation. */
export function communityPagePath(pathname:string, search:string, sort='hot', anchor='') {
  const query=new URLSearchParams(search);
  if(pathname==='/') {
    if(sort==='recommended')return null;
    const params=new URLSearchParams({sort});
    for(const key of ['board','tag'])if(query.get(key))params.set(key,query.get(key)!);
    return 'pages/feed?'+params;
  }
  const board=/^\/community\/c\/([^/]+)$/.exec(pathname);
  if(board&&!['news','forecasts'].includes(board[1]))return 'pages/feed?'+new URLSearchParams({sort:query.get('sort')==='latest'?'latest':'activity',board:decodeURIComponent(board[1])});
  const post=/^\/community\/posts\/([^/]+)$/.exec(pathname);
  if(post){
    const params=new URLSearchParams();
    if(query.get('thread'))params.set('thread',query.get('thread')!);
    params.set('sort',query.get('sort')==='latest'?'latest':'hot');
    if(anchor.startsWith('#cm-'))params.set('focus',anchor.slice(4));
    return 'pages/posts/'+post[1]+(params.size?'?'+params:'');
  }
  return null;
}
