/** One canonical address for community views; old #/ bookmarks remain readable. */
export function communityHref(hash: string) {
  if (!hash.startsWith('#/')) return hash;
  const route = hash.slice(2);
  return route === '' || route.startsWith('?') ? '/' + route : '/community/' + route;
}
export function communityHash(pathname: string, search = '', hash = '') {
  if (hash.startsWith('#/')) return hash;
  return pathname.startsWith('/community/') ? '#/' + pathname.slice('/community/'.length) + search + hash : '#/' + search + (hash.startsWith('#') ? hash : '');
}
export const isCommunityPath = (pathname: string) => pathname === '/' || pathname.startsWith('/community/');
/** Community commands use the same client router as links. */
export function navigateCommunity(hash: string) {
  window.dispatchEvent(new CustomEvent('umeet:navigate', {detail:communityHref(hash)}));
}
