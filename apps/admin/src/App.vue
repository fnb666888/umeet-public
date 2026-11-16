<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import {
  LayoutDashboard,
  FileText,
  MessageCircle,
  ShieldCheck,
  Flag,
  Users,
  School,
  ScrollText,
  Activity,
  LogOut,
  ArrowUpRight,
  ArrowRight,
  RefreshCw,
  Search,
  X,
  Check,
  ChevronRight,
  Leaf,
  Plus,
  Inbox,
  Bell,
} from 'lucide-vue-next';
import { client, labels, date, imageUrl } from './api';
import StudentPreview from './StudentPreview.vue';
import Announcements from './Announcements.vue';
const studentView = location.pathname.startsWith('/preview');
const api = client('umeet-admin-token');
const token = ref(sessionStorage.getItem('umeet-admin-token') || '');
const demo = ref(false),
  password = ref(''),
  error = ref(''),
  notice = ref(''),
  busy = ref(false),
  loading = ref(false);
const tab = ref('overview'),
  status = ref('PENDING'),
  search = ref('');
const overview = ref<any>({ trend: [] }),
  rows = ref<any[]>([]),
  schools = ref<any[]>([]),
  selected = ref<any>(null),
  photos = ref<string[]>([]);
const action = ref<any>(null),
  reason = ref(''),
  trace = ref<any>(null);
const schoolForm = ref({ id: '', name: '', domains: '', treeholeEnabled: false });
const campusForm = ref({ id: '', name: '', schoolId: '' });
const nav = [
  { id: 'overview', name: '社区概览', icon: LayoutDashboard },
  { id: 'posts', name: '内容审核', icon: FileText },
  { id: 'comments', name: '评论管理', icon: MessageCircle },
  { id: 'verifications', name: '校园认证', icon: ShieldCheck },
  { id: 'reports', name: '举报与申诉', icon: Flag },
  { id: 'users', name: '用户管理', icon: Users },
  { id: 'schools', name: '学校与校区', icon: School },
  { id: 'feedback', name: '意见反馈', icon: Inbox },
  { id: 'jobs', name: '任务状态', icon: Activity },
  { id: 'audit', name: '操作记录', icon: ScrollText },
];
nav.splice(7, 0, { id: 'announcements', name: '公告与指南', icon: FileText });
nav.splice(10, 0, { id: 'deliveries', name: '订阅发送记录', icon: Bell });
const title = computed(() => nav.find((n) => n.id === tab.value)?.name || '');
const filtered = computed(() =>
  rows.value.filter((r) => JSON.stringify(r).toLowerCase().includes(search.value.toLowerCase())),
);
const metrics = computed(() => [
  {
    label: '已发布内容',
    value: overview.value.posts || 0,
    icon: FileText,
    detail: '让有用的信息被看见',
  },
  {
    label: '认证学生',
    value: overview.value.members || 0,
    icon: Users,
    detail: '校园信任，从身份开始',
  },
  {
    label: '待处理内容',
    value: (overview.value.pending || 0) + (overview.value.comments || 0),
    icon: ShieldCheck,
    detail: '帖子与评论审核',
  },
  {
    label: '待处理举报',
    value: overview.value.reports || 0,
    icon: Flag,
    detail: '维护友善的社区氛围',
  },
]);
async function login(isDemo = false) {
  busy.value = true;
  error.value = '';
  try {
    const data = await api(
      isDemo ? '/auth/demo' : '/auth/admin',
      'POST',
      isDemo ? { role: 'admin' } : { password: password.value },
    );
    sessionStorage.setItem('umeet-admin-token', data.token);
    token.value = data.token;
    password.value = '';
    await load();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function logout() {
  try {
    await api('/auth/logout', 'POST');
  } catch {}
  sessionStorage.removeItem('umeet-admin-token');
  token.value = '';
}
async function load() {
  if (!token.value) return;
  loading.value = true;
  error.value = '';
  try {
    overview.value = await api('/admin/overview');
    if (tab.value === 'schools') schools.value = await api('/schools');
    else if (!['overview', 'announcements'].includes(tab.value))
      rows.value = await api(
        '/admin/' + tab.value + (tab.value === 'posts' ? '?status=' + status.value : ''),
      );
  } catch (e: any) {
    error.value = e.message;
    if (!sessionStorage.getItem('umeet-admin-token')) token.value = '';
  } finally {
    loading.value = false;
  }
}
async function switchTab(id: string) {
  tab.value = id;
  search.value = '';
  rows.value = [];
  await load();
}
async function select(row: any) {
  closeDetail();
  selected.value = row;
  if (row.mediaIds?.length)
    for (const id of row.mediaIds) {
      try {
        photos.value.push(await imageUrl(id, 'umeet-admin-token'));
      } catch (e: any) {
        error.value = e.message;
      }
    }
  if (row.materialId)
    try {
      photos.value.push(await imageUrl(row.materialId, 'umeet-admin-token'));
    } catch (e: any) {
      error.value = e.message;
    }
}
function closeDetail() {
  photos.value.forEach(URL.revokeObjectURL);
  photos.value = [];
  selected.value = null;
  trace.value = null;
}
function prepare(kind: string, row: any, decision?: string) {
  reason.value = decision === 'APPROVE' ? '经人工审核，内容符合社区规则。' : '';
  action.value = { kind, row, decision };
}
async function execute() {
  if (reason.value.trim().length < 2) {
    error.value = '请填写处理说明';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const a = action.value,
      r = a.row;
    if (a.kind === 'post')
      await api(`/admin/posts/${r.id}/review`, 'POST', {
        decision: a.decision,
        reason: reason.value,
        version: r.version,
      });
    if (a.kind === 'comment')
      await api(`/admin/comments/${r.id}/review`, 'POST', {
        decision: a.decision,
        reason: reason.value,
      });
    if (a.kind === 'verification')
      await api(`/admin/verifications/${r.id}/review`, 'POST', {
        approve: a.decision === 'APPROVE',
        reason: reason.value,
      });
    if (a.kind === 'report')
      await api(`/admin/reports/${r.id}/resolve`, 'POST', {
        decision: a.decision,
        reason: reason.value,
      });
    if (a.kind === 'ban')
      await api(`/admin/users/${r.id}/ban`, 'PUT', { banned: !r.banned, reason: reason.value });
    if (a.kind === 'feedback')
      await api(`/admin/feedback/${r.id}/resolve`, 'POST', { reason: reason.value });
    if (a.kind === 'trace') {
      trace.value = await api(`/admin/posts/${r.id}/trace`, 'POST', { reason: reason.value });
      action.value = null;
      return;
    }
    action.value = null;
    closeDetail();
    notice.value = '处理结果已保存';
    setTimeout(() => (notice.value = ''), 3000);
    await load();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function retry(row: any) {
  try {
    await api(`/admin/jobs/${row.id}/retry`, 'POST');
    await load();
  } catch (e: any) {
    error.value = e.message;
  }
}
async function saveSchool() {
  try {
    await api('/admin/schools', 'POST', {
      id: schoolForm.value.id,
      name: schoolForm.value.name,
      emailDomains: schoolForm.value.domains
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
      treeholeEnabled: schoolForm.value.treeholeEnabled,
    });
    notice.value = '学校配置已保存';
    await load();
  } catch (e: any) {
    error.value = e.message;
  }
}
async function saveCampus() {
  try {
    await api('/admin/campuses', 'POST', campusForm.value);
    notice.value = '校区已保存';
    await load();
  } catch (e: any) {
    error.value = e.message;
  }
}
function editSchool(s: any) {
  schoolForm.value = {
    id: s.id,
    name: s.name,
    domains: s.emailDomains.join(','),
    treeholeEnabled: s.treeholeEnabled,
  };
  campusForm.value.schoolId = s.id;
}
onMounted(async () => {
  if (studentView) return;
  try {
    demo.value = (await api('/config')).demo;
    await load();
  } catch (e: any) {
    error.value = e.message;
  }
});
onBeforeUnmount(closeDetail);
</script>

<template>
  <StudentPreview v-if="studentView" />
  <div v-else-if="!token" class="login-page">
    <section class="login-story">
      <a class="brand" href="/"
        ><span class="brand-mark">u<span></span></span>umeet<span class="brand-sub"
          >校园社区</span
        ></a
      >
      <div>
        <span class="eyebrow">A LITTLE CLOSER, EVERY DAY</span>
        <h1>让校园里的善意，<br />在这里相遇。</h1>
        <p>从一条求助，到一次回应。<br />一起守护真实、友善、有温度的学生社区。</p>
        <div class="story-art">
          <span class="art-card art-one">↗ 一起学习</span><span class="art-circle">u.</span
          ><span class="art-card art-two">☘ 分享善意</span>
        </div>
      </div>
      <small>Umeet · 校园社区运营工作台</small>
    </section>
    <section class="login-form">
      <div class="login-inner">
        <span class="eyebrow green">COMMUNITY WORKSPACE</span>
        <h2>欢迎回来</h2>
        <p class="muted">登录工作台，照顾好每一次校园里的相遇。</p>
        <form @submit.prevent="login()">
          <label
            >管理员密码<input
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              placeholder="输入管理员密码" /></label
          ><button class="primary wide" :disabled="busy">
            {{ busy ? '正在登录…' : '进入工作台' }}<ArrowRight :size="18" />
          </button>
        </form>
        <button v-if="demo" class="outline wide" :disabled="busy" @click="login(true)">
          本地演示 · 管理员登录
        </button>
        <div v-if="error" class="alert">{{ error }}</div>
        <a href="/preview" class="preview-link">看看学生端交互预览 <ArrowUpRight :size="15" /></a
        ><small class="muted">管理员操作会记录在审计日志中。</small>
      </div>
    </section>
  </div>
  <div v-else class="workspace">
    <aside class="sidebar">
      <a class="brand" href="/"
        ><span class="brand-mark">u<span></span></span>umeet</a
      ><span class="workspace-label">社区运营工作台</span>
      <nav>
        <button
          v-for="item in nav"
          :key="item.id"
          :class="{ active: tab === item.id }"
          @click="switchTab(item.id)"
        >
          <component :is="item.icon" :size="18" />{{ item.name
          }}<span v-if="item.id === 'posts' && overview.pending" class="nav-count">{{
            overview.pending
          }}</span>
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="care-note">
          <Leaf :size="19" />
          <p>认真对待每一条内容，<br />也认真对待每一个人。</p>
        </div>
        <a href="/preview" target="_blank"><ArrowUpRight :size="16" />学生端预览</a
        ><button @click="logout"><LogOut :size="16" />退出登录</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <span>工作台 <ChevronRight :size="14" /> {{ title }}</span>
        <div>
          <span v-if="demo" class="demo-tag">本地开发环境</span><span class="avatar">管</span
          ><b>平台管理员</b>
        </div>
      </header>
      <main>
        <div class="page-heading">
          <div>
            <span class="eyebrow green">{{
              tab === 'overview' ? 'COMMUNITY AT A GLANCE' : 'COMMUNITY MANAGEMENT'
            }}</span>
            <h1>{{ tab === 'overview' ? '你好，校园的守护者。' : title }}</h1>
            <p>
              {{
                tab === 'overview'
                  ? '看看社区今天的动态，让每一份分享都得到妥善回应。'
                  : '在这里查看、核实并处理社区信息。'
              }}
            </p>
          </div>
          <button class="outline" @click="load" :disabled="loading">
            <RefreshCw :size="16" :class="{ spinning: loading }" />刷新数据
          </button>
        </div>
        <div v-if="error" class="alert" role="alert">
          {{ error }}<button @click="error = ''">×</button>
        </div>
        <div v-if="notice" class="success" role="status">{{ notice }}</div>
        <template v-if="tab === 'overview'"
          ><section class="metric-grid">
            <article v-for="m in metrics" :key="m.label" class="metric">
              <div>
                <span>{{ m.label }}</span
                ><component :is="m.icon" :size="19" />
              </div>
              <strong>{{ m.value }}</strong
              ><small>{{ m.detail }}</small>
            </article>
          </section>
          <div class="dashboard-grid">
            <section class="panel">
              <div class="panel-head">
                <div>
                  <h2>社区的每一天</h2>
                  <p>近 7 天内容发布量 · 含待审内容</p>
                </div>
                <span class="pill">最近一周</span>
              </div>
              <div class="bar-chart">
                <div v-for="day in overview.trend" :key="day.date">
                  <span class="bar-value">{{ day.count }}</span>
                  <div
                    class="bar"
                    :style="{
                      height:
                        20 +
                        (day.count / Math.max(1, ...overview.trend.map((v: any) => v.count))) *
                          150 +
                        'px',
                    }"
                  ></div>
                  <small>{{ day.date.slice(5).replace('-', '/') }}</small>
                </div>
              </div>
            </section>
            <section class="panel todo-panel">
              <div class="panel-head">
                <div>
                  <h2>需要你看一看</h2>
                  <p>社区待办，逐一照顾</p>
                </div>
                <Bell :size="18" />
              </div>
              <button
                v-for="todo in [
                  { id: 'posts', name: '帖子审核', count: overview.pending, icon: FileText },
                  {
                    id: 'comments',
                    name: '评论审核',
                    count: overview.comments,
                    icon: MessageCircle,
                  },
                  {
                    id: 'verifications',
                    name: '校园身份认证',
                    count: overview.verifications,
                    icon: ShieldCheck,
                  },
                  { id: 'reports', name: '举报与申诉', count: overview.reports, icon: Flag },
                ]"
                :key="todo.id"
                class="todo"
                @click="switchTab(todo.id)"
              >
                <span class="todo-icon"><component :is="todo.icon" :size="18" /></span
                ><b>{{ todo.name }}</b
                ><span>{{ todo.count || 0 }}</span
                ><ChevronRight :size="16" />
              </button>
            </section>
          </div>
          <section class="welcome-banner">
            <div>
              <span class="eyebrow">BUILD A KINDER CAMPUS</span>
              <h2>一个好的社区，从一次认真回应开始。</h2>
              <p>发布、交流、互助，让校园生活多一点连接。</p>
            </div>
            <a href="/preview" target="_blank">探索学生端<ArrowUpRight :size="18" /></a
            ><span class="banner-u">u.</span>
          </section></template
        >
        <template v-else-if="tab === 'schools'"
          ><div class="dashboard-grid">
            <section class="panel">
              <h2>学校与校区</h2>
              <div v-for="s in schools" :key="s.id" class="school-row">
                <span class="todo-icon"><School :size="20" /></span>
                <div>
                  <b>{{ s.name }}</b>
                  <p>{{ s.campuses.map((c: any) => c.name).join(' · ') || '尚未添加校区' }}</p>
                  <small
                    >树洞 {{ s.treeholeEnabled ? '已开启' : '未开启' }} · 邮箱
                    {{ s.emailDomains.join('、') || '未配置' }}</small
                  >
                </div>
                <button class="outline" @click="editSchool(s)">编辑</button>
              </div>
            </section>
            <section class="panel">
              <h2>配置学校</h2>
              <form @submit.prevent="saveSchool" class="stack">
                <label
                  >学校编号<input
                    v-model="schoolForm.id"
                    required
                    placeholder="例如：my-university" /></label
                ><label>学校名称<input v-model="schoolForm.name" required /></label
                ><label
                  >认证邮箱域名<input
                    v-model="schoolForm.domains"
                    placeholder="多个域名用英文逗号分隔" /></label
                ><label class="check-label"
                  ><input
                    type="checkbox"
                    v-model="schoolForm.treeholeEnabled"
                  />开放匿名树洞（需安排审核人员）</label
                ><button class="primary">保存学校配置</button>
              </form>
              <hr />
              <h2>添加或修改校区</h2>
              <form @submit.prevent="saveCampus" class="stack">
                <label
                  >所属学校<select v-model="campusForm.schoolId" required>
                    <option value="">请选择</option>
                    <option v-for="s in schools" :value="s.id" :key="s.id">{{ s.name }}</option>
                  </select></label
                ><label>校区编号<input v-model="campusForm.id" required /></label
                ><label>校区名称<input v-model="campusForm.name" required /></label
                ><button class="outline">保存校区</button>
              </form>
            </section>
          </div></template
        >
        <Announcements v-else-if="tab === 'announcements'" />
        <section v-else class="panel list-panel">
          <div class="list-toolbar">
            <div v-if="tab === 'posts'" class="segmented">
              <button
                v-for="s in ['PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN']"
                :key="s"
                :class="{ active: status === s }"
                @click="
                  status = s;
                  load();
                "
              >
                {{ labels[s] }}
              </button>
            </div>
            <span v-else class="pill">{{ filtered.length }} 条记录</span
            ><label class="search"
              ><Search :size="16" /><input v-model="search" placeholder="搜索当前列表"
            /></label>
          </div>
          <div v-if="loading" class="empty">正在加载…</div>
          <div v-else-if="!filtered.length" class="empty">
            <span><Check :size="28" /></span>
            <h3>这里暂时没有待处理的事项</h3>
            <p>新的内容到达时，会出现在这里。</p>
          </div>
          <div v-else class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ tab === 'users' ? '学生' : '内容 / 事项' }}</th>
                  <th>{{ tab === 'audit' ? '操作' : '状态 / 类别' }}</th>
                  <th>时间</th>
                  <th class="right">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in filtered" :key="r.id">
                  <td>
                    <b>{{
                      r.title ||
                      r.post?.title ||
                      r.user?.nickname ||
                      r.nickname ||
                      r.kind ||
                      r.action ||
                      r.content?.slice(0, 40) ||
                      '认证申请'
                    }}</b>
                    <p>
                      {{
                        r.reason ||
                        r.content?.slice(0, 65) ||
                        r.schoolName ||
                        r.school?.name ||
                        r.error ||
                        r.targetId ||
                        r.id.slice(0, 18)
                      }}
                    </p>
                  </td>
                  <td>
                    <span class="pill" :class="r.banned || r.status === 'FAILED' ? 'danger' : ''">{{
                      tab === 'users'
                        ? r.banned
                          ? '已限制'
                          : '正常'
                        : labels[r.category || r.status] || r.action || '待处理'
                    }}</span
                    ><small v-if="r.anonymous" class="anon-note">匿名内容</small>
                  </td>
                  <td class="muted nowrap">{{ date(r.createdAt) }}</td>
                  <td class="right">
                    <button
                      v-if="tab === 'jobs' && r.status === 'FAILED'"
                      class="text-button"
                      @click="retry(r)"
                    >
                      重试</button
                    ><button
                      v-else-if="tab === 'users'"
                      class="text-button"
                      @click="prepare('ban', r)"
                    >
                      {{ r.banned ? '解除限制' : '限制账号' }}</button
                    ><button v-else class="text-button" @click="select(r)">
                      查看<ArrowRight :size="14" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <footer>Umeet Community Workspace<span>有用的分享，友善的回应。</span></footer>
      </main>
    </div>
    <div v-if="selected" class="overlay" @click.self="closeDetail">
      <section class="drawer">
        <header>
          <div>
            <span class="eyebrow green">REVIEW DETAILS</span>
            <h2>查看与处理</h2>
          </div>
          <button class="icon-button" @click="closeDetail" aria-label="关闭"><X /></button>
        </header>
        <div class="drawer-body">
          <span class="pill">{{ labels[selected.category || selected.status] || title }}</span>
          <h2>
            {{
              selected.title ||
              selected.post?.title ||
              selected.user?.nickname ||
              selected.action ||
              '事项详情'
            }}
          </h2>
          <p class="muted">
            {{ date(selected.createdAt) }}{{ selected.anonymous ? ' · 匿名内容' : '' }}
          </p>
          <p class="content-text">
            {{ selected.content || selected.reason || selected.error || '' }}
          </p>
          <pre v-if="selected.snapshot">{{ JSON.stringify(selected.snapshot, null, 2) }}</pre>
          <pre v-if="selected.detail">{{ JSON.stringify(selected.detail, null, 2) }}</pre>
          <div class="review-photos">
            <img v-for="src in photos" :src="src" :key="src" alt="待核验图片" />
          </div>
          <p v-if="selected.moderationReason" class="review-note">
            {{ selected.moderationReason }}
          </p>
          <div v-if="trace" class="review-note">
            追溯结果：{{ trace.nickname }} · {{ trace.userId }}
          </div>
          <button
            v-if="tab === 'posts' && selected.anonymous"
            class="text-button"
            @click="prepare('trace', selected)"
          >
            授权身份追溯（记录原因）
          </button>
        </div>
        <div
          class="drawer-actions"
          v-if="['posts', 'comments', 'verifications', 'reports', 'feedback'].includes(tab)"
        >
          <template v-if="tab === 'posts' || tab === 'comments'"
            ><button
              class="outline"
              @click="prepare(tab === 'posts' ? 'post' : 'comment', selected, 'REJECT')"
            >
              不通过</button
            ><button
              class="outline"
              @click="prepare(tab === 'posts' ? 'post' : 'comment', selected, 'HIDE')"
            >
              隐藏</button
            ><button
              class="primary"
              @click="prepare(tab === 'posts' ? 'post' : 'comment', selected, 'APPROVE')"
            >
              <Check :size="17" />审核通过
            </button></template
          ><template v-if="tab === 'verifications'"
            ><button class="outline" @click="prepare('verification', selected, 'REJECT')">
              驳回认证</button
            ><button class="primary" @click="prepare('verification', selected, 'APPROVE')">
              通过认证
            </button></template
          ><template v-if="tab === 'reports'"
            ><button class="outline" @click="prepare('report', selected, 'REJECT')">
              维持现状并结案</button
            ><button class="primary" @click="prepare('report', selected, 'HIDE')">
              隐藏被举报内容
            </button></template
          ><button v-if="tab === 'feedback'" class="primary" @click="prepare('feedback', selected)">
            回复并处理
          </button>
        </div>
      </section>
    </div>
    <div v-if="action" class="overlay modal-layer" @click.self="!busy && (action = null)">
      <section class="modal">
        <h2>{{ action.kind === 'trace' ? '填写追溯事由' : '确认处理结果' }}</h2>
        <p class="muted">处理说明将被记录，相关结果会通知用户。</p>
        <textarea
          v-model="reason"
          rows="4"
          maxlength="500"
          placeholder="请填写具体原因或处理说明"
        ></textarea>
        <p v-if="error" class="alert">{{ error }}</p>
        <div class="modal-actions">
          <button class="outline" :disabled="busy" @click="action = null">取消</button
          ><button class="primary" :disabled="busy" @click="execute">
            {{ busy ? '保存中…' : '确认提交' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
