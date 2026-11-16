export type Actor = { userId: string; kind: string; nickname?: string; platformRoles?: string[] };
const key = 'umeet:session:v2';
let generation = 0;
export function session(): { token: string; actor: Actor } | null {
  const value = wx.getStorageSync(key);
  return value?.token && value?.actor?.userId ? value : null;
}
export function epoch() {
  return generation;
}
export function saveSession(value: { token: string; actor: Actor }) {
  generation++;
  wx.setStorageSync(key, value);
}
export function clearSession() {
  generation++;
  wx.removeStorageSync(key);
}
export function currentUser() {
  return session()?.actor.userId ?? '';
}
export function requireLogin() {
  if (session()) return true;
  wx.navigateTo({ url: '/features/account/index' });
  return false;
}
export function draftKey(kind: string, id = 'new') {
  const user = currentUser();
  if (!user) throw new Error('请先登录');
  return 'umeet:draft:' + user + ':' + kind + ':' + id;
}
export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
