/* 浏览器内的演示存档，图片以 Blob 保存。 */
let demoDb;
let storageWarningShown = false;
const savedStateKeys = [
  'best', 'boardSort', 'bookmarks', 'commentLikes', 'composerDraft', 'followedBoards',
  'follows', 'likes', 'reading', 'readNotifications', 'replyDrafts', 'tagFollows', 'threads',
];

async function restoreDemo(){
  try {
    demoDb = await new Promise((resolve, reject) => {
      const request = indexedDB.open('umeet-web-ux', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('demo');
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => reject(request.error);
    });
    const snapshot = await new Promise((resolve, reject) => {
      const request = demoDb.transaction('demo').objectStore('demo').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (![1, 2].includes(snapshot?.version)) return;
    posts.splice(0, posts.length, ...snapshot.posts);
    notifications.splice(0, notifications.length, ...snapshot.notifications);
    Object.assign(comments, snapshot.comments);
    if (Array.isArray(snapshot.wiki)) wiki.splice(0, wiki.length, ...snapshot.wiki);
    for (const key of savedStateKeys){
      if (Object.hasOwn(snapshot.state, key)) S[key] = snapshot.state[key];
    }
    if (snapshot.version === 1){
      for (const slug of snapshot.state.pinnedBoards || []) S.followedBoards.add(slug);
    }
    Object.assign(notifPrefs, snapshot.notificationPreferences);
    if (snapshot.version === 1) saveDemo();
  } catch {
    demoDb = undefined;
  }
}

function storageWarning(){
  if (storageWarningShown) return;
  storageWarningShown = true;
  toast('浏览器未能保存本地数据，请保留当前页面');
}

function saveDemo(){
  if (!demoDb){ storageWarning(); return; }
  try {
    const transaction = demoDb.transaction('demo', 'readwrite');
    transaction.onabort = storageWarning;
    transaction.objectStore('demo').put({
      version:2, posts, comments, wiki, notifications, notificationPreferences:notifPrefs,
      state:Object.fromEntries(savedStateKeys.map(key => [key, S[key]])),
    }, 'current');
    transaction.commit?.();
  } catch {
    storageWarning();
  }
}

const imageUrls = new WeakMap();
function imageSrc(image){
  if (!(image instanceof Blob)) return image;
  if (!imageUrls.has(image)) imageUrls.set(image, URL.createObjectURL(image));
  return imageUrls.get(image);
}
