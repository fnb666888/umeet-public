<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import {
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Heart,
  MessageCircle,
  Bookmark,
  X,
  Send,
  MapPin,
  ChevronDown,
  Leaf,
  ShoppingBag,
  HelpCircle,
  KeyRound,
  Cloud,
  BookOpen,
  Bell,
  UserRound,
  Home,
  School,
  ShieldCheck,
  Flag,
  Check,
  ImagePlus,
  LogOut,
  RefreshCw,
} from 'lucide-vue-next';
import { client, labels, date, imageUrl } from './api';
const api = client('umeet-student-token');
const token = ref(sessionStorage.getItem('umeet-student-token') || ''),
  me = ref<any>(null),
  demo = ref(false);
const schools = ref<any[]>([]),
  schoolId = ref('demo-school'),
  campusId = ref(''),
  category = ref(''),
  sort = ref('latest'),
  query = ref(''),
  tab = ref('home');
const posts = ref<any[]>([]),
  nextCursor = ref<string | null>(null),
  loading = ref(false),
  error = ref(''),
  toast = ref('');
const detail = ref<any>(null),
  comments = ref<any[]>([]),
  reply = ref(''),
  parentId = ref(''),
  photos = ref<string[]>([]),
  notifications = ref<any[]>([]),
  mine = ref<any[]>([]),
  collection = ref<any[]>([]),
  requests = ref<any[]>([]),
  blocks = ref<any[]>([]);
const composing = ref(false),
  form = ref<any>({
    category: 'GENERAL',
    title: '',
    content: '',
    campusId: 'main',
    price: '',
    condition: '',
    location: '',
    lostType: 'LOST',
    happenedAt: '',
    marketType: 'SELL',
    contact: '',
  }),
  mediaIds = ref<string[]>([]),
  localImages = ref<string[]>([]),
  sending = ref(false),
  requestKey = ref(crypto.randomUUID());
const modal = ref(''),
  modalText = ref(''),
  material = ref<File | null>(null),
  email = ref(''),
  code = ref(''),
  emailRequest = ref(''),
  nickname = ref('');
const school = computed(() => schools.value.find((s) => s.id === schoolId.value));
const verified = computed(() =>
  me.value?.memberships?.some((m: any) => m.schoolId === schoolId.value && m.status === 'VERIFIED'),
);
const unread = computed(() => notifications.value.filter((n) => !n.readAt).length);
const categories = [
  { id: '', name: '全部内容', icon: Home },
  { id: 'GENERAL', name: '校园日常', icon: Leaf },
  { id: 'HELP', name: '打听求助', icon: HelpCircle },
  { id: 'MARKET', name: '闲置集市', icon: ShoppingBag },
  { id: 'LOST', name: '失物招领', icon: KeyRound },
  { id: 'TREEHOLE', name: '匿名树洞', icon: Cloud },
  { id: 'GUIDE', name: '校园指南', icon: BookOpen },
];
function notify(text: string) {
  toast.value = text;
  setTimeout(() => (toast.value = ''), 3500);
}
async function run(fn: () => Promise<void>) {
  error.value = '';
  try {
    await fn();
  } catch (e: any) {
    error.value = e.message;
  }
}
async function profile() {
  if (!token.value) {
    me.value = null;
    return;
  }
  try {
    me.value = await api('/me');
    nickname.value = me.value.nickname;
  } catch {
    token.value = '';
    me.value = null;
  }
}
async function login() {
  await run(async () => {
    const data = await api('/auth/demo', 'POST', { role: 'student' });
    sessionStorage.setItem('umeet-student-token', data.token);
    token.value = data.token;
    await profile();
    await feed();
    notify('欢迎回来，林同学');
  });
}
async function logout() {
  await run(async () => {
    await api('/auth/logout', 'POST');
    sessionStorage.removeItem('umeet-student-token');
    token.value = '';
    me.value = null;
    tab.value = 'home';
    category.value = '';
    await feed();
  });
}
async function feed(append = false) {
  loading.value = true;
  await run(async () => {
    const q = new URLSearchParams({ schoolId: schoolId.value, sort: sort.value });
    if (category.value) q.set('category', category.value);
    if (campusId.value) q.set('campusId', campusId.value);
    if (query.value) q.set('q', query.value);
    if (append && nextCursor.value) q.set('cursor', nextCursor.value);
    const data = await api('/posts?' + q);
    posts.value = append ? [...posts.value, ...data.items] : data.items;
    nextCursor.value = data.nextCursor;
  });
  loading.value = false;
}
async function pickCategory(id: string) {
  if (id === 'TREEHOLE' && !verified.value) {
    notify('请先登录并完成校园认证');
    tab.value = 'me';
    return;
  }
  category.value = id;
  tab.value = 'home';
  await feed();
}
async function changeSchool() {
  campusId.value = '';
  category.value = '';
  await feed();
}
async function changeTab(id: string) {
  tab.value = id;
  if (id === 'home') await feed();
  if (id === 'messages' && token.value)
    await run(async () => (notifications.value = await api('/notifications')));
  if (id === 'me' && token.value)
    await run(async () => {
      await profile();
      [mine.value, collection.value, requests.value, blocks.value] = await Promise.all([
        api('/me/posts'),
        api('/me/bookmarks'),
        api('/me/verifications'),
        api('/me/blocks'),
      ]);
    });
}
function close() {
  photos.value.forEach(URL.revokeObjectURL);
  photos.value = [];
  detail.value = null;
  comments.value = [];
  reply.value = '';
  parentId.value = '';
}
async function open(id: string) {
  await run(async () => {
    close();
    detail.value = await api('/posts/' + id);
    if (detail.value.full) {
      if (token.value && detail.value.status === 'PUBLISHED')
        comments.value = await api('/posts/' + id + '/comments');
      for (const m of detail.value.mediaIds)
        photos.value.push(await imageUrl(m, 'umeet-student-token'));
    }
  });
}
async function reaction(type: string) {
  if (!detail.value) return;
  await run(async () => {
    await api('/posts/' + detail.value.id + '/reactions', 'POST', {
      type,
      active: type === 'LIKE' ? !detail.value.liked : !detail.value.bookmarked,
    });
    const id = detail.value.id;
    await open(id);
    await feed();
  });
}
async function sendReply() {
  if (!reply.value.trim()) return;
  sending.value = true;
  await run(async () => {
    await api('/posts/' + detail.value.id + '/comments', 'POST', {
      content: reply.value,
      ...(parentId.value ? { parentId: parentId.value } : {}),
    });
    reply.value = '';
    parentId.value = '';
    comments.value = await api('/posts/' + detail.value.id + '/comments');
    notify('评论已提交，等待审核');
  });
  sending.value = false;
}
function compose() {
  if (!verified.value) {
    notify('认证后就可以分享啦');
    tab.value = 'me';
    return;
  }
  form.value = {
    category: category.value || 'GENERAL',
    title: '',
    content: '',
    campusId: school.value?.campuses?.[0]?.id || '',
    price: '',
    condition: '',
    location: '',
    lostType: 'LOST',
    happenedAt: '',
    marketType: 'SELL',
    contact: '',
  };
  mediaIds.value = [];
  localImages.value.forEach(URL.revokeObjectURL);
  localImages.value = [];
  requestKey.value = crypto.randomUUID();
  composing.value = true;
}
async function upload(event: Event) {
  const files = (event.target as HTMLInputElement).files;
  if (!files) return;
  sending.value = true;
  await run(async () => {
    for (const file of Array.from(files).slice(0, 6 - mediaIds.value.length)) {
      const body = new FormData();
      body.append('file', file);
      const m = await api('/media?purpose=POST', 'POST', body);
      mediaIds.value.push(m.id);
      localImages.value.push(URL.createObjectURL(file));
    }
  });
  sending.value = false;
}
async function publish(draft = false) {
  sending.value = true;
  await run(async () => {
    const f = form.value;
    const payload: any = {
      schoolId: schoolId.value,
      campusId: f.campusId,
      category: f.category,
      title: f.title,
      content: f.content,
      mediaIds: mediaIds.value,
      draft,
    };
    if (f.category === 'MARKET') {
      if (!/^\d+(\.\d{1,2})?$/.test(f.price)) throw new Error('请输入正确的价格');
      payload.priceFen = Math.round(Number(f.price) * 100);
      payload.marketType = f.marketType;
      if (f.condition) payload.condition = f.condition;
    }
    if (f.category === 'LOST') {
      payload.lostType = f.lostType;
      if (f.happenedAt)
        payload.happenedAt = new Date(f.happenedAt + 'T12:00:00+08:00').toISOString();
      if (f.location) payload.location = f.location;
    }
    if (f.category !== 'TREEHOLE' && f.contact) payload.contact = f.contact;
    await api('/posts', 'POST', payload, { 'Idempotency-Key': requestKey.value });
    composing.value = false;
    localImages.value.forEach(URL.revokeObjectURL);
    localImages.value = [];
    notify(draft ? '草稿已保存' : '已提交，审核结果会通知你');
    await changeTab('me');
  });
  sending.value = false;
}
async function contact() {
  await run(async () => {
    const data = await api('/posts/' + detail.value.id + '/contact');
    modal.value = 'contact';
    modalText.value = data.contact || '发布者没有提供联系方式，请在评论区交流。';
  });
}
async function finish() {
  await run(async () => {
    const p = detail.value;
    const state =
      p.category === 'MARKET'
        ? 'SOLD'
        : p.category === 'LOST'
          ? 'FOUND'
          : p.category === 'HELP'
            ? 'SOLVED'
            : 'CLOSED';
    await api('/posts/' + p.id + '/state', 'PUT', { state });
    await open(p.id);
    notify('状态已更新');
  });
}
async function sendModal() {
  sending.value = true;
  await run(async () => {
    if (modal.value === 'report')
      await api('/posts/' + detail.value.id + '/reports', 'POST', { reason: modalText.value });
    if (modal.value === 'feedback') await api('/feedback', 'POST', { reason: modalText.value });
    if (modal.value === 'profile') await api('/me', 'PUT', { nickname: nickname.value });
    if (modal.value === 'delete') {
      await api('/posts/' + detail.value.id, 'DELETE');
      close();
      await changeTab('me');
    }
    if (modal.value === 'block') {
      await api('/posts/' + detail.value.id + '/block-author', 'POST');
      close();
      await feed();
    }
    if (modal.value === 'account') {
      await api('/me', 'DELETE');
      sessionStorage.removeItem('umeet-student-token');
      token.value = '';
      me.value = null;
      tab.value = 'home';
      category.value = '';
      await feed();
    }
    if (modal.value === 'appeal')
      await api('/posts/' + detail.value.id + '/appeal', 'POST', { reason: modalText.value });
    modal.value = '';
    await profile();
    notify('操作已完成');
  });
  sending.value = false;
}
async function submitMaterial() {
  if (!material.value) {
    notify('请选择认证材料');
    return;
  }
  sending.value = true;
  await run(async () => {
    const body = new FormData();
    body.append('file', material.value!);
    const file = await api('/media?purpose=VERIFICATION', 'POST', body);
    await api('/verifications/manual', 'POST', { schoolId: schoolId.value, materialId: file.id });
    modal.value = '';
    notify('认证申请已提交');
    await changeTab('me');
  });
  sending.value = false;
}
async function sendCode() {
  await run(async () => {
    const r = await api('/verifications/email', 'POST', {
      schoolId: schoolId.value,
      email: email.value,
    });
    emailRequest.value = r.id;
    notify('验证码已发送');
  });
}
async function confirmCode() {
  await run(async () => {
    const r = await api('/verifications/email/confirm', 'POST', {
      id: emailRequest.value,
      code: code.value,
    });
    if (!r.ok) throw new Error(r.message);
    modal.value = '';
    await profile();
    notify('校园认证已通过');
  });
}
async function markAll() {
  await run(async () => {
    await api('/notifications/read-all', 'POST');
    notifications.value = await api('/notifications');
  });
}
async function editDraft(p: any) {
  await open(p.id);
  form.value = {
    category: p.category,
    title: p.title,
    content: p.content,
    campusId: p.campusId,
    price: p.priceFen == null ? '' : String(p.priceFen / 100),
    condition: p.condition || '',
    location: p.location || '',
    lostType: p.lostType || 'LOST',
    happenedAt: p.happenedAt ? new Date(p.happenedAt).toISOString().slice(0, 10) : '',
    marketType: p.marketType || 'SELL',
    contact: p.contact || '',
  };
  mediaIds.value = [...p.mediaIds];
  localImages.value = [];
  composing.value = true;
}
const editingId = ref('');
async function saveEdit(draft = false) {
  if (!editingId.value) return publish(draft);
  sending.value = true;
  await run(async () => {
    const f = form.value;
    const payload: any = {
      schoolId: schoolId.value,
      campusId: f.campusId,
      category: f.category,
      title: f.title,
      content: f.content,
      mediaIds: mediaIds.value,
      draft,
    };
    if (f.category === 'MARKET') {
      if (!/^\d+(\.\d{1,2})?$/.test(f.price)) throw new Error('请输入正确的价格');
      payload.priceFen = Math.round(Number(f.price) * 100);
      payload.marketType = f.marketType;
    }
    if (f.category === 'LOST') payload.lostType = f.lostType;
    if (f.happenedAt) payload.happenedAt = new Date(f.happenedAt + 'T12:00:00+08:00').toISOString();
    if (f.location) payload.location = f.location;
    if (f.condition) payload.condition = f.condition;
    if (f.category !== 'TREEHOLE' && f.contact) payload.contact = f.contact;
    await api('/posts/' + editingId.value, 'PUT', payload);
    editingId.value = '';
    composing.value = false;
    close();
    await changeTab('me');
    notify('已保存，提交内容将重新审核');
  });
  sending.value = false;
}
onMounted(async () => {
  await run(async () => {
    demo.value = (await api('/config')).demo;
    schools.value = await api('/schools');
    if (!schools.value.some((s) => s.id === schoolId.value))
      schoolId.value = schools.value[0]?.id || '';
    await profile();
    await feed();
  });
});
onBeforeUnmount(() => {
  close();
  localImages.value.forEach(URL.revokeObjectURL);
});
</script>
<template>
  <div class="student-app">
    <header class="student-header">
      <a class="brand" href="/preview"
        ><span class="brand-mark">u<span></span></span>umeet<span class="brand-sub"
          >校园里的每一次相遇</span
        ></a
      >
      <div class="student-nav">
        <button :class="{ active: tab === 'home' }" @click="changeTab('home')">社区</button
        ><button :class="{ active: tab === 'campus' }" @click="changeTab('campus')">校园</button
        ><button :class="{ active: tab === 'messages' }" @click="changeTab('messages')">
          消息<span v-if="unread" class="dot"></span></button
        ><button :class="{ active: tab === 'me' }" @click="changeTab('me')">我的</button>
      </div>
      <button
        class="primary"
        @click="
          editingId = '';
          compose();
        "
      >
        <Plus :size="17" />分享一下
      </button>
    </header>
    <div class="student-shell">
      <aside class="student-sidebar">
        <label class="school-select"
          ><School :size="17" /><select v-model="schoolId" @change="changeSchool">
            <option v-for="s in schools" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select></label
        ><span class="eyebrow green">YOUR CAMPUS, YOUR COMMUNITY</span>
        <h2>在校园，<br />遇见同频的你。</h2>
        <nav>
          <button
            v-for="c in categories"
            :key="c.id"
            :class="{ active: category === c.id && tab === 'home' }"
            @click="pickCategory(c.id)"
          >
            <component :is="c.icon" :size="19" />{{ c.name
            }}<ArrowUpRight v-if="category === c.id && tab === 'home'" :size="15" />
          </button>
        </nav>
        <div class="sidebar-quote">“善意会在每一次<br />回应里，慢慢生长。”<Leaf :size="22" /></div>
        <a href="/" class="muted workspace-link">运营工作台 <ArrowUpRight :size="14" /></a>
      </aside>
      <main class="student-main">
        <div v-if="error" class="alert" role="alert">
          {{ error }}<button @click="error = ''">×</button>
        </div>
        <template v-if="tab === 'home'"
          ><section class="student-hero">
            <div>
              <span class="eyebrow">GOOD THINGS HAPPEN HERE</span>
              <h1>小小校园，<br />大大的连接。</h1>
              <p>分享日常，交换闲置，找到答案。<br />你的校园生活，值得被认真回应。</p>
              <button
                @click="
                  editingId = '';
                  compose();
                "
              >
                从一条分享开始 <ArrowRight :size="16" />
              </button>
            </div>
            <div class="hero-shapes">
              <span class="shape-a"></span><span class="shape-b"></span
              ><span class="shape-c">u.</span><span class="shape-caption">meet your people.</span>
            </div>
          </section>
          <div class="feed-heading">
            <h2>
              {{ category ? labels[category] : '校园新鲜事' }}<span>每一条分享，都有温度</span>
            </h2>
            <button class="icon-button" @click="feed()" aria-label="刷新">
              <RefreshCw :size="17" />
            </button>
          </div>
          <div class="feed-controls">
            <div class="segmented">
              <button
                :class="{ active: sort === 'latest' }"
                @click="
                  sort = 'latest';
                  feed();
                "
              >
                最新</button
              ><button
                :class="{ active: sort === 'hot' }"
                @click="
                  sort = 'hot';
                  feed();
                "
              >
                热门
              </button>
            </div>
            <select v-model="campusId" @change="feed()">
              <option value="">全部校区</option>
              <option v-for="c in school?.campuses" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <form class="search" @submit.prevent="feed()">
              <Search :size="16" /><input v-model="query" placeholder="搜索校园里的分享" />
            </form>
          </div>
          <div v-if="loading" class="empty">正在寻找校园的新鲜事…</div>
          <div v-else-if="!posts.length" class="empty">
            <Leaf :size="32" />
            <h3>这里等着你的第一条分享</h3>
            <p>试试换个分类，或者分享一件校园小事。</p>
            <button class="primary" @click="compose">写一条分享</button>
          </div>
          <article v-for="p in posts" :key="p.id" class="post-card" @click="open(p.id)">
            <div class="post-meta">
              <span class="student-avatar" :class="{ anonymous: p.anonymous }">{{
                p.anonymous ? '☁' : p.authorName.slice(0, 1)
              }}</span>
              <div>
                <b>{{ p.authorName }}</b
                ><small>{{ p.campusName }} · {{ date(p.createdAt) }}</small>
              </div>
              <span class="category-tag" :class="p.category.toLowerCase()"
                >{{ labels[p.category]
                }}{{ p.category === 'MARKET' && p.marketType === 'WANTED' ? ' · 求购' : '' }}</span
              >
            </div>
            <h3>{{ p.title }}</h3>
            <p class="post-excerpt">{{ p.content }}</p>
            <div class="post-footer">
              <span v-if="p.priceFen != null" class="price"
                >¥{{ (p.priceFen / 100).toFixed(2) }}</span
              ><span v-if="p.businessStatus !== 'ACTIVE'" class="pill">{{
                labels[p.businessStatus]
              }}</span
              ><span v-else class="place"><MapPin :size="13" />{{ p.campusName }}</span>
              <div>
                <span><Heart :size="15" />{{ p.likeCount }}</span
                ><span><MessageCircle :size="15" />{{ p.commentCount }}</span
                ><ArrowUpRight :size="16" />
              </div>
            </div>
          </article>
          <button v-if="nextCursor" class="outline wide" @click="feed(true)">看看更多分享</button>
          <div class="feed-end" v-else-if="posts.length">今天的相遇，先到这里 ☘</div></template
        >
        <template v-if="tab === 'campus'"
          ><span class="eyebrow green">MAKE CAMPUS LIFE A LITTLE EASIER</span>
          <h1 class="section-title">校园生活，有人与你一起。</h1>
          <p class="muted">从生活的小事开始，找到需要的信息。</p>
          <div class="campus-grid">
            <button
              v-for="c in categories.filter((c) =>
                ['HELP', 'MARKET', 'LOST', 'GUIDE'].includes(c.id),
              )"
              :key="c.id"
              @click="pickCategory(c.id)"
            >
              <component :is="c.icon" :size="29" />
              <h3>{{ c.name }}</h3>
              <p>
                {{
                  c.id === 'HELP'
                    ? '一个问题，很多种善意的答案。'
                    : c.id === 'MARKET'
                      ? '让闲置，走进下一段校园生活。'
                      : c.id === 'LOST'
                        ? '遗失的东西，也许就在这里等你。'
                        : '校园生活的实用经验，一起分享。'
                }}
              </p>
              <ArrowUpRight :size="18" />
            </button>
          </div>
          <div class="community-note">
            <ShieldCheck :size="25" />
            <div>
              <h3>同校认证，让交流多一点信任</h3>
              <p>联系方式仅向同校认证学生提供。闲置交易请当面核验物品，自主确认。</p>
            </div>
          </div></template
        >
        <template v-if="tab === 'messages'"
          ><div class="feed-heading">
            <h1 class="section-title">每一份回应，都在这里。</h1>
            <button v-if="token" class="text-button" @click="markAll">
              <Check :size="16" />全部已读
            </button>
          </div>
          <div v-if="!token" class="empty">
            <Bell :size="30" />
            <h3>登录后查看你的消息</h3>
            <button v-if="demo" class="primary" @click="login">开发演示登录</button>
          </div>
          <div v-else-if="!notifications.length" class="empty">
            <Bell :size="30" />
            <h3>新的回应很快会来到这里</h3>
            <p>评论回复、审核与认证结果都会在这里通知你。</p>
          </div>
          <button
            v-for="n in notifications"
            :key="n.id"
            class="notification-card"
            @click="
              run(async () => {
                await api('/notifications/' + n.id + '/read', 'POST');
                n.readAt = new Date().toISOString();
                if (n.postId) await open(n.postId);
              })
            "
          >
            <span class="todo-icon"><Bell :size="18" /></span>
            <div>
              <h3>{{ n.title }}<i v-if="!n.readAt" class="dot"></i></h3>
              <p>{{ n.body }}</p>
              <small>{{ date(n.createdAt) }}</small>
            </div>
            <ChevronDown :size="17" /></button
        ></template>
        <template v-if="tab === 'me'"
          ><section class="profile-card">
            <span class="profile-avatar">{{ me?.nickname?.slice(0, 1) || 'u.' }}</span>
            <div>
              <h1>{{ me?.nickname || '你好，新同学。' }}</h1>
              <p>
                {{ verified ? '同校认证 · 一起建设友善的校园' : '让校园里的相遇，从认识你开始。' }}
              </p>
            </div>
            <button v-if="demo && !token" class="primary" @click="login">开发演示登录</button
            ><button v-if="token" class="outline" @click="modal = 'profile'">编辑资料</button>
          </section>
          <p v-if="!token && !demo" class="community-note">请在微信小程序中登录与认证。</p>
          <template v-if="token"
            ><div class="verification-banner">
              <ShieldCheck :size="27" />
              <div>
                <h3>{{ verified ? '你的校园认证已通过' : '加入你的校园社区' }}</h3>
                <p>
                  {{ school?.name }} ·
                  {{
                    verified
                      ? '认证有效期可在小程序个人中心查看。'
                      : '通过学校邮箱或认证材料验证学生身份。'
                  }}
                </p>
              </div>
              <button v-if="!verified" class="outline" @click="modal = 'verify'">申请认证</button
              ><span v-else class="pill">已认证</span>
            </div>
            <div v-if="requests.length" class="panel">
              <h3>认证申请</h3>
              <p v-for="r in requests" :key="r.id">
                {{ labels[r.status] || r.status }} · {{ r.reason || '申请已提交' }} ·
                {{ date(r.createdAt) }}
              </p>
            </div>
            <h2 class="block-title">
              我的发布 <small>{{ mine.length }}</small>
            </h2>
            <div v-if="!mine.length" class="empty compact">
              还没有分享，写下你的第一条校园故事吧。
            </div>
            <article v-for="p in mine" :key="p.id" class="my-post">
              <div @click="open(p.id)">
                <b>{{ p.title }}</b>
                <p>{{ labels[p.category] }} · {{ date(p.createdAt) }}</p>
              </div>
              <span class="pill">{{ labels[p.status] }}</span
              ><button
                class="text-button"
                @click="
                  editingId = p.id;
                  editDraft(p);
                "
              >
                编辑
              </button>
            </article>
            <h2 class="block-title">
              我的收藏 <small>{{ collection.length }}</small>
            </h2>
            <article v-for="p in collection" :key="p.id" class="my-post" @click="open(p.id)">
              <b>{{ p.title }}</b
              ><Bookmark :size="17" />
            </article>
            <div v-if="!collection.length" class="empty compact">
              值得回看的内容，可以收藏在这里。
            </div>
            <h2 v-if="blocks.length" class="block-title">已屏蔽用户</h2>
            <article v-for="b in blocks" :key="b.id" class="my-post">
              <b>{{ b.label }}</b
              ><button
                class="text-button"
                @click="
                  run(async () => {
                    await api('/me/blocks/' + b.id, 'DELETE');
                    await changeTab('me');
                  })
                "
              >
                解除屏蔽
              </button>
            </article>
            <div class="profile-actions">
              <button
                @click="
                  modal = 'feedback';
                  modalText = '';
                "
              >
                意见反馈<ArrowUpRight :size="15" /></button
              ><button @click="modal = 'privacy'">隐私与社区规则<ArrowUpRight :size="15" /></button
              ><button @click="logout">退出登录<LogOut :size="15" /></button
              ><button @click="modal = 'account'">注销账号</button>
            </div></template
          ></template
        >
      </main>
      <aside class="student-right">
        <section class="right-note">
          <span class="eyebrow green">WELCOME TO UMEET</span>
          <h3>同一个校园，<br />多一种连接。</h3>
          <p>真实分享，友善交流。<br />每一个普通的校园日常，<br />都值得被认真对待。</p>
          <div class="tiny-avatars">
            <span>林</span><span>周</span><span>陈</span><span>你</span>
          </div>
        </section>
        <section class="right-guide">
          <span class="eyebrow green">A GOOD PLACE TO START</span>
          <h3>新同学，从这里开始</h3>
          <button @click="pickCategory('GUIDE')">
            <BookOpen :size="18" />读一份校园指南<ArrowUpRight :size="14" /></button
          ><button @click="changeTab('me')">
            <ShieldCheck :size="18" />完成校园身份认证<ArrowUpRight :size="14" /></button
          ><button @click="pickCategory('HELP')">
            <HelpCircle :size="18" />寻找一个问题的答案<ArrowUpRight :size="14" />
          </button>
        </section>
        <p class="right-bottom">Umeet · 微信小程序交互预览<br />校园里的每一次相遇。</p>
      </aside>
    </div>
    <nav class="mobile-nav">
      <button
        v-for="n in [
          { id: 'home', name: '社区', icon: Home },
          { id: 'campus', name: '校园', icon: School },
          { id: 'messages', name: '消息', icon: Bell },
          { id: 'me', name: '我的', icon: UserRound },
        ]"
        :key="n.id"
        :class="{ active: tab === n.id }"
        @click="changeTab(n.id)"
      >
        <component :is="n.icon" :size="20" />{{ n.name }}
      </button>
    </nav>
    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    <div v-if="detail" class="overlay" @click.self="close">
      <section class="drawer student-drawer">
        <header>
          <span class="pill">{{ labels[detail.category] }}</span
          ><button class="icon-button" @click="close"><X /></button>
        </header>
        <div class="drawer-body">
          <p class="muted">{{ detail.authorName }} · {{ date(detail.createdAt) }}</p>
          <h1>{{ detail.title }}</h1>
          <p class="content-text">{{ detail.content }}</p>
          <p v-if="detail.priceFen != null" class="price large">
            {{ detail.marketType === 'WANTED' ? '求购预算 ' : '' }}¥{{
              (detail.priceFen / 100).toFixed(2)
            }}
          </p>
          <p v-if="detail.happenedAt" class="muted">日期：{{ date(detail.happenedAt) }}</p>
          <p v-if="detail.location" class="muted">{{ detail.location }}</p>
          <div class="review-photos">
            <img v-for="src in photos" :src="src" :key="src" alt="帖子图片" />
          </div>
          <div v-if="!detail.full" class="community-note">
            完成同校认证，即可查看完整内容与参与交流。
          </div>
          <div v-if="detail.full && detail.status === 'PUBLISHED'" class="detail-actions">
            <button class="outline" @click="reaction('LIKE')">
              <Heart :size="16" :fill="detail.liked ? 'currentColor' : 'none'" />{{
                detail.likeCount
              }}</button
            ><button class="outline" @click="reaction('BOOKMARK')">
              <Bookmark :size="16" />{{ detail.bookmarked ? '已收藏' : '收藏' }}</button
            ><button v-if="!detail.anonymous" class="primary" @click="contact">联系发布者</button
            ><button
              v-if="detail.own && detail.businessStatus === 'ACTIVE'"
              class="outline"
              @click="finish"
            >
              标记{{
                detail.category === 'MARKET'
                  ? '已出'
                  : detail.category === 'LOST'
                    ? '已找回'
                    : detail.category === 'HELP'
                      ? '已解决'
                      : '结束'
              }}
            </button>
          </div>
          <div v-if="detail.own && detail.moderationReason" class="review-note">
            审核说明：{{ detail.moderationReason }}
          </div>
          <h3 v-if="detail.full" class="block-title">一起聊聊</h3>
          <article v-for="c in comments" :key="c.id" class="comment">
            <b>{{ c.authorName }} <small v-if="c.author">发布者</small></b>
            <p>{{ c.content }}</p>
            <small>{{ date(c.createdAt) }} · {{ labels[c.status] }}</small
            ><button
              v-if="c.status === 'PUBLISHED'"
              class="text-button"
              @click="
                parentId = c.id;
                reply = '';
              "
            >
              回复</button
            ><button
              v-if="c.own"
              class="text-button"
              @click="
                run(async () => {
                  await api('/comments/' + c.id, 'DELETE');
                  comments = await api('/posts/' + detail.id + '/comments');
                })
              "
            >
              删除
            </button>
          </article>
          <div v-if="detail.full && detail.status === 'PUBLISHED'">
            <p v-if="parentId" class="muted">
              正在回复一条评论 <button class="text-button" @click="parentId = ''">取消</button>
            </p>
            <form class="comment-form" @submit.prevent="sendReply">
              <input v-model="reply" maxlength="500" placeholder="让善意，从一句回应开始…" /><button
                class="primary"
                :disabled="sending"
              >
                <Send :size="17" />
              </button>
            </form>
          </div>
          <div class="minor-actions">
            <button
              v-if="!detail.own && detail.full"
              @click="
                modal = 'report';
                modalText = '';
              "
            >
              举报</button
            ><button v-if="!detail.own && detail.full" @click="modal = 'block'">屏蔽发布者</button
            ><button v-if="detail.own" @click="modal = 'delete'">删除帖子</button
            ><button
              v-if="detail.own && ['REJECTED', 'HIDDEN'].includes(detail.status)"
              @click="
                modal = 'appeal';
                modalText = '';
              "
            >
              提交申诉
            </button>
          </div>
        </div>
      </section>
    </div>
    <div v-if="composing" class="overlay" @click.self="!sending && (composing = false)">
      <section class="modal compose-modal">
        <header>
          <div>
            <span class="eyebrow green">SHARE YOUR CAMPUS LIFE</span>
            <h2>{{ editingId ? '编辑分享' : '今天，想分享些什么？' }}</h2>
          </div>
          <button class="icon-button" @click="composing = false"><X /></button>
        </header>
        <form @submit.prevent="saveEdit(false)" class="stack">
          <div class="form-row">
            <label
              >内容分类<select v-model="form.category">
                <option v-for="c in categories.filter((c) => c.id)" :key="c.id" :value="c.id">
                  {{ c.name }}
                </option>
              </select></label
            ><label
              >校区<select v-model="form.campusId">
                <option v-for="c in school?.campuses" :key="c.id" :value="c.id">
                  {{ c.name }}
                </option>
              </select></label
            >
          </div>
          <input
            v-model="form.title"
            class="title-input"
            placeholder="给这条分享起个标题"
            minlength="2"
            maxlength="60"
            required
          /><textarea
            v-model="form.content"
            rows="6"
            minlength="5"
            maxlength="2000"
            required
            placeholder="说说你的日常、问题，或者想分享的小事…"
          ></textarea>
          <div v-if="form.category === 'MARKET'" class="form-row">
            <label
              >类型<select v-model="form.marketType">
                <option value="SELL">出售闲置</option>
                <option value="WANTED">求购闲置</option>
              </select></label
            ><label
              >价格 / 预算（元）<input
                v-model="form.price"
                inputmode="decimal"
                placeholder="0.00"
                required /></label
            ><label>成色<input v-model="form.condition" placeholder="例如九成新" /></label>
          </div>
          <div v-if="form.category === 'LOST'" class="form-row">
            <label
              >类型<select v-model="form.lostType">
                <option value="LOST">我丢失了物品</option>
                <option value="FOUND">我拾到了物品</option>
              </select></label
            ><label>日期<input type="date" v-model="form.happenedAt" /></label
            ><label>地点<input v-model="form.location" placeholder="请勿填写完整证件信息" /></label>
          </div>
          <label v-if="form.category !== 'TREEHOLE'"
            >联系方式（选填）<input
              v-model="form.contact"
              maxlength="100"
              placeholder="仅向同校认证用户提供"
          /></label>
          <p v-else class="review-note">
            对其他用户匿名，同帖身份保持一致。平台可按授权处理违规内容。
          </p>
          <div class="upload-row">
            <label class="upload-button"
              ><ImagePlus :size="20" />添加图片 {{ mediaIds.length }}/6<input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                @change="upload"
                :disabled="sending || mediaIds.length >= 6" /></label
            ><img v-for="src in localImages" :src="src" :key="src" alt="待上传图片" />
          </div>
          <p v-if="error" class="alert">{{ error }}</p>
          <div class="modal-actions">
            <button type="button" class="outline" :disabled="sending" @click="saveEdit(true)">
              保存草稿</button
            ><button class="primary" :disabled="sending">
              {{ sending ? '提交中…' : '提交分享' }}<ArrowRight :size="16" />
            </button>
          </div>
        </form>
      </section>
    </div>
    <div v-if="modal" class="overlay modal-layer" @click.self="modal = ''">
      <section class="modal">
        <header>
          <h2>
            {{
              (
                {
                  report: '举报内容',
                  feedback: '意见反馈',
                  profile: '编辑资料',
                  verify: '校园身份认证',
                  contact: '联系发布者',
                  privacy: '隐私与社区规则',
                  delete: '删除这条分享？',
                  block: '屏蔽发布者？',
                  account: '注销账号？',
                  appeal: '提交申诉',
                } as any
              )[modal]
            }}
          </h2>
          <button class="icon-button" @click="modal = ''"><X /></button>
        </header>
        <template v-if="modal === 'verify'"
          ><p class="muted">只提交验证学校归属需要的信息，遮挡无关姓名、证件号等字段。</p>
          <label
            >人工认证材料<input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              @change="material = ($event.target as HTMLInputElement).files?.[0] || null" /></label
          ><button class="primary wide" :disabled="sending" @click="submitMaterial">
            提交材料审核
          </button>
          <hr />
          <label
            >学校邮箱<input v-model="email" type="email" placeholder="输入学校认证邮箱" /></label
          ><button class="outline wide" @click="sendCode">发送验证码</button>
          <div v-if="emailRequest" class="form-row">
            <input v-model="code" placeholder="六位验证码" maxlength="6" /><button
              class="primary"
              @click="confirmCode"
            >
              验证
            </button>
          </div></template
        ><template v-else-if="modal === 'contact'"
          ><p class="content-text">{{ modalText }}</p>
          <p class="muted">请尊重发布者隐私，避免向外传播联系方式。</p></template
        ><template v-else-if="modal === 'privacy'"
          ><p class="content-text">
            请尊重他人，不发布骚扰、诈骗和未经允许的个人信息。平台为登录、认证、内容互动处理必要数据。认证材料以私有权限保存；匿名内容对其他用户匿名，授权治理可追溯。你可以管理发布记录、屏蔽用户、反馈问题或注销账号。正式运营前将公布适用主体、联系方式、数据保留期限和完整隐私政策。
          </p></template
        ><template v-else>
          <textarea
            v-if="['report', 'feedback', 'appeal'].includes(modal)"
            v-model="modalText"
            rows="4"
            maxlength="500"
            placeholder="请填写具体说明"
          ></textarea
          ><label v-if="modal === 'profile'"
            >昵称<input v-model="nickname" minlength="2" maxlength="20"
          /></label>
          <p v-if="['delete', 'block', 'account'].includes(modal)" class="muted">
            {{
              modal === 'delete'
                ? '删除后帖子会从社区隐藏。'
                : modal === 'block'
                  ? '屏蔽后，不再向你展示对方的帖子和评论。'
                  : '注销后账号无法继续使用，发布内容将隐藏，认证关联将撤销。'
            }}
          </p>
          <div class="modal-actions">
            <button class="outline" @click="modal = ''">取消</button
            ><button class="primary" :disabled="sending" @click="sendModal">确认</button>
          </div></template
        >
        <p v-if="error" class="alert">{{ error }}</p>
      </section>
    </div>
  </div>
</template>
