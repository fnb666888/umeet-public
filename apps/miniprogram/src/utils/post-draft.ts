// Large image drafts live in a private app file; storage holds a small account-scoped index.
export function savePostDraft(key: string, value: any) {
  const json = JSON.stringify(value);
  if (json.length < 700000) {
    wx.setStorageSync(key, value);
    return;
  }
  const fs = wx.getFileSystemManager(),
    dir = wx.env.USER_DATA_PATH + '/post-drafts';
  try {
    fs.mkdirSync(dir, true);
  } catch {}
  const filePath = dir + '/' + encodeURIComponent(key) + '.json';
  fs.writeFileSync(filePath, json, 'utf8');
  wx.setStorageSync(key, {
    title: value.title,
    body: value.body,
    community: value.community,
    id: value.id,
    filePath,
  });
}
export function readPostDraft(key: string) {
  const value = wx.getStorageSync(key);
  return value?.filePath
    ? JSON.parse(wx.getFileSystemManager().readFileSync(value.filePath, 'utf8') as string)
    : value;
}
export function removePostDraft(key: string) {
  const value = wx.getStorageSync(key);
  wx.removeStorageSync(key);
  if (value?.filePath) {
    try {
      wx.getFileSystemManager().unlinkSync(value.filePath);
    } catch {}
  }
}
