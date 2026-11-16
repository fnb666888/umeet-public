export function applyTheme(page: any) {
  const choice = wx.getStorageSync('umeet:theme') || 'system';
  const system = wx.getAppBaseInfo().theme;
  const dark = choice === 'dark' || (choice === 'system' && system === 'dark');
  page.setData({ theme: dark ? 'dark' : 'light' });
  wx.setNavigationBarColor({
    frontColor: dark ? '#ffffff' : '#000000',
    backgroundColor: dark ? '#171b22' : '#ffffff',
  });
  wx.setTabBarStyle({
    color: dark ? '#a9b1bc' : '#636b74',
    selectedColor: '#3568d4',
    backgroundColor: dark ? '#171b22' : '#ffffff',
    borderStyle: dark ? 'black' : 'white',
  });
}
export function pageTheme(definition: any) {
  const show = definition.onShow;
  definition.onShow = function (...args: any[]) {
    applyTheme(this);
    return show?.apply(this, args);
  };
  return definition;
}
