'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileText,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type {
  AdminItem,
  AdminList,
  AdminOverview,
  AdminSection,
  ModerationAccess,
  ModerationPermission,
} from '../../../../../packages/contracts/src/admin';
import { permits } from '../../../../../packages/contracts/src/moderation-permissions';
import { ThemeSelector } from '../community/Theme';
import { AdminDetails } from './AdminDetails';
import { adminRequest, cachedAdminRead, invalidateAdminReads, adminResources, initialAdminRead } from './admin-api';
import './admin.css';
import { boards, updateBoardDirectory } from '../community/model';
import { governanceRequest } from '../community/governance-client';
import type { BoardSummary } from '../../../../../packages/contracts/src/boards';
import { PermissionGroups } from './PermissionGroups';
import { UserMemberships } from './UserMemberships';
import { SiteSettings } from './SiteSettings';
import { CommunityBoardSettings } from './CommunityBoardSettings';
import '../community/governance.css';
import { CommunityTeams } from './CommunityTeams';
import { ApplicationReviews } from './ApplicationReviews';
import { confirmSettingsLeave } from './use-unsaved-settings';
import { AdminIdentity } from './AdminIdentity';
import { InterestAdmin } from '../interest/Admin';
import { routePrefetch } from '../../lib/prefetch-scheduler';
import { accountState } from '../../lib/browser-session';
import { refreshAccountContext } from '../../lib/browser-session';
import type { AdminBootstrap } from '../../lib/admin-bootstrap-server';

const sections = [
  { id: 'content', title: '内容管理', icon: FileText },
  { id: 'interest', title: '资讯与预测', icon: BookOpen },
  { id: 'users', title: '用户管理', icon: Users },
  { id: 'wiki', title: 'Wiki 管理', icon: BookOpen },
  { id: 'team', title: '群组管理', icon: ShieldCheck },
  { id: 'settings', title: '站点设置', icon: Settings },
  { id: 'applications', title: '申请管理', icon: FileText },
  { id: 'teams', title: '管理团队', icon: Users },
  { id: 'board-settings', title: '板块设置', icon: Settings },
] as const;
const contentTabs = [
  { id: 'reports', title: '举报队列' },
  { id: 'appeals', title: '申诉复核' },
  { id: 'trash', title: '回收站' },
] as const;
const userTabs = [
  ['all', '全部用户'],
  ['active', '活跃用户'],
  ['new', '新用户'],
  ['staff', '管理人员'],
  ['muted', '限制参与'],
  ['suspended', '已停用'],
];
const restrictedUserTabs = [['restricted', '受限用户']];
const targetTypes = {
  post: '帖子',
  reply: '回复',
  message: '私信',
  user: '用户',
  wiki: 'Wiki',
  profile: '个人资料',
  account: '账号行为',
  appeal: '申诉',
} as Record<string, string>;
export const adminStatus: Record<string, string> = {
  pending: '待处理',
  approved: '已通过',
  rejected: '未通过',
  handled: '已处理',
  dismissed: '已驳回',
  hidden: '已隐藏',
  visible: '公开',
  active: '正常',
  restricted: '受限中',
  deleted: '已注销',
  recorded: '已记录',
  escalated: '已升级全站',
  upheld: '维持处置',
  reversed: '已撤销处置',
  suspended: '已停用',
  muted: '限制参与',
  partial: '部分撤销',
};
export const actionNames: Record<string, string> = {
  disposition: '用户处置',
  participation: '限制参与',
  deactivation: '停用账号',
  warning: '警告用户',
  'content.delete.participation': '删除内容并限制参与',
  penalty: '用户处置',
  'content.delete': '删除内容',
  'content.restore': '恢复内容',
  'report.dismiss': '驳回举报',
  'account.mute': '限制参与',
  'account.suspend': '停用账号',
  'penalty.revoke': '解除处置',
  'appeal.review': '申诉复核',
  'case.escalate': '升级举报',
  'content.label': '内容标记',
  'wiki.manage': 'Wiki 治理',
  visibility: '内容展示调整',
  report: '处理举报',
  restriction: '调整参与限制',
  'wiki.restore': '恢复 Wiki',
  'wiki.protect': '调整 Wiki 保护',
  'case.resolve': '举报结案',
  'member.role': '调整社区权限',
  'post.settings': '调整帖子',
  note: '内部备注',
  'group.save': '配置群组权限',
  'group.member': '调整群组成员',
  'settings.site': '修改站点设置',
  'settings.invite': '生成注册邀请码',
  'post.review': '首帖审核',
};
export const adminDate = (date: string) =>
  new Date(date).toLocaleString('zh-CN', { hour12: false });

const adminShortDate = (date: string) =>
  new Date(date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

export function AdminWorkspace({ communityMode = false, initialData = null }: { communityMode?: boolean; initialData?: AdminBootstrap | null }) {
  const initial = useRef(initialData);
  const router = useRouter();
  const [accessRevision, refreshAccess] = useState(0);
  const [access, setAccess] = useState<ModerationAccess | null>(() => cachedAdminRead<ModerationAccess>('access') ?? initialData?.access ?? null);
  const [board, setBoard] = useState(() => {
    if (typeof location === 'undefined') return '';
    const previous = cachedAdminRead<ModerationAccess>('access');
    const requested = new URLSearchParams(location.search).get('board');
    return previous?.boards.find(item => item.board === requested)?.board || (communityMode ? previous?.boards[0]?.board || '' : '');
  });
  const [, refreshBoardNames] = useState(0);
  const [accessError, setAccessError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const readAccess = async () => {
      if (initial.current) {
        const data = initial.current;
        const state = await refreshAccountContext();
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        initial.current = null;
        if (state.currentUserId !== data.userId) throw new Error('账号状态已变化，请刷新后重试');
        adminResources.seed('access', data.access);
        adminResources.seed(data.path, data.list);
        return data.access;
      }
      return communityMode ? adminRequest<ModerationAccess>('access', undefined, controller.signal) : initialAdminRead(new URLSearchParams(location.search), controller.signal);
    };
    void readAccess()
      .then((value) => {
        if (controller.signal.aborted) return;
        setAccessError('');
        const requested = new URLSearchParams(location.search).get('board');
        const requestedBoard = value.boards.find((item) => item.board === requested)?.board;
        if (communityMode && value.admin) {
          router.replace('/admin' + (requestedBoard ? '?board=' + requestedBoard : ''));
          return;
        }
        setAccess(value);
        if (communityMode) {
          setBoard(requestedBoard || value.boards[0]?.board || '');
          if (!value.boards.length) setAccessError('当前账号尚未获得社区管理权限');
        } else if (!value.admin) setAccessError('当前账号没有全站管理权限');
        else if (requestedBoard) setBoard(requestedBoard);
        // Names are auxiliary; loading them must not block the management view.
        void governanceRequest<BoardSummary[]>('boards').then(value => {
          if (!controller.signal.aborted) {
            updateBoardDirectory(value);
            refreshBoardNames(revision => revision + 1);
          }
        }).catch(() => {});
      })
      .catch((error) => {
        if (!controller.signal.aborted) setAccessError(error.message);
      });
    return () => controller.abort();
  }, [communityMode, accessRevision]);
  const [sectionOverride, setSection] = useState<
    AdminSection | 'settings' | 'applications' | 'teams' | 'board-settings' | 'interest' | null
  >(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [list, setList] = useState<AdminList | null>(initialData?.list ?? null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [statusOverride, setStatus] = useState<string | null>(null);
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminItem | null>(null);
  const [record, setRecord] = useState('');
  const listScroll = useRef(0);
  const restoreListScroll = useRef(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => adminResources.subscribe(event => {
    if (event.type === 'invalidate') { setRevision(value => value + 1); refreshAccess(value => value + 1); }
    if (event.type === 'evict' && !initial.current) { setAccess(null); setList(null); setAccessError('账号或管理权限已变化，请刷新后重试'); }
  }), []);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!initialData);
  const [success, setSuccess] = useState('');
  const detailsRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const boardAccess = access?.boards.find((entry) => entry.board === board);
  const grants = boardAccess?.permissions;
  const can = (permission: ModerationPermission) => permits(grants, permission);
  const availableTabs = contentTabs.filter((tab) =>
    can(tab.id === 'appeals' ? 'appeals.view' : tab.id === 'trash' ? 'content' : tab.id),
  );
  const defaultSection =
    availableTabs[0]?.id ??
    (can('users') ? 'users' : can('wiki') ? 'wiki' : can('history') ? 'history' : null);
  const activeSection = sectionOverride ?? defaultSection;
  const section = activeSection ?? 'reports';
  const restrictedUsers = communityMode && section === 'users';
  const status =
    statusOverride ??
    (restrictedUsers
      ? 'restricted'
      : section === 'reports' || section === 'appeals' || section === 'reviews'
        ? 'pending'
        : 'all');
  const canReadReports = can('reports');
  const detailItem = record
    ? list?.items.find((item) => item.id === record || item.reportIds?.includes(record)) ||
      (selected?.id === record ? selected : null)
    : selected;
  const viewingDetail = Boolean(record || selected);
  const isContent =
    section === 'reviews' || section === 'history' || contentTabs.some((tab) => tab.id === section);
  const groupCards = section === 'team' && Boolean(access?.admin);
  function warmSection(value: string, priority = 1) {
    const state = accountState();
    return routePrefetch.enqueue(JSON.stringify([state?.deviceId,state?.version,state?.currentUserId,board,value]), () => prepareSection(value), priority);
  }
  function prepareSection(value: string) {
    const target = value === 'content' ? availableTabs[0]?.id || 'history' : value;
    if (target === 'settings') return adminRequest('site-settings').then(() => undefined).catch(() => {});
    if (target === 'team' && access?.admin) return adminRequest('groups').then(() => undefined).catch(() => {});
    if (target === 'interest') return import('../interest/api').then(module => module.interestApi('admin')).then(() => undefined).catch(() => {});
    if (target === 'applications') return governanceRequest('applications?' + (board ? 'board=' + board : 'admin=1')).then(() => undefined).catch(() => {});
    if (target === 'teams') return governanceRequest('teams' + (board ? '?board=' + board : '')).then(() => undefined).catch(() => {});
    if (target === 'board-settings' && board) return governanceRequest('board-settings?board=' + board).then(() => undefined).catch(() => {});
    if (!['reports', 'appeals', 'trash', 'history', 'users', 'wiki'].includes(target)) return Promise.resolve();
    const path = 'items?' + new URLSearchParams({ section: target, q: '',
      status: ['reports', 'appeals'].includes(target) ? 'pending' : communityMode && target === 'users' ? 'restricted' : 'all',
      kind: 'all', page: '1', ...(board ? { board } : {}),
    });
    return adminRequest(path).then(() => undefined).catch(() => {});
  }
  useEffect(() => {
    if (!access || accessError || !list) return;
    let active = true;
    const timer = setTimeout(() => { void (async () => {
      const targets = [can('users') && 'users', can('wiki') && 'wiki', can('reports') && 'reports', can('appeals.view') && 'appeals', can('content') && 'trash', can('history') && 'history', access.admin && 'team', access.admin && 'settings', access.admin && 'interest', access.admin && 'applications', 'teams', board && 'board-settings'].filter(Boolean) as string[];
      for (const target of targets) { if (!active) break; void warmSection(target, 0); }
    })(); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [access, accessError, board, Boolean(list)]);

  useEffect(() => {
    if (!access || accessError || !canReadReports || (communityMode && !board)) return;
    const controller = new AbortController();
    void refreshAccountContext().then(() => {
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return adminRequest<AdminOverview>('overview' + (board ? '?board=' + board : ''), undefined, controller.signal);
    })
      .then(value => { if (!controller.signal.aborted) setOverview(value); })
      .catch(() => { if (!controller.signal.aborted) setOverview(null); });
    return () => controller.abort();
  }, [access, accessError, canReadReports, board, communityMode, revision]);

  useEffect(() => {
    function readRecord() {
      const params = new URLSearchParams(location.search);
      let view = params.get('view');
      if (communityMode && view === 'applications') {
        view = 'teams';
        const url = new URL(location.href);
        url.searchParams.set('view', view);
        history.replaceState(null, '', url);
      }
      const id = params.get('record');
      setSelected(null);
      if (
        view &&
        [
          'users',
          'team',
          'reports',
          'appeals',
          'trash',
          'wiki',
          'history',
          'settings',
          'applications',
          'teams',
          'board-settings',
          'interest',
        ].includes(view) &&
        !id
      ) {
        setSection(
          view as
            AdminSection | 'settings' | 'applications' | 'teams' | 'board-settings' | 'interest',
        );
        setRecord('');
      } else if (
        id &&
        (view === 'reports' || view === 'appeals' || view === 'reviews' || view === 'users')
      ) {
        setSection(view);
        setRecord(id);
      } else setRecord('');
    }
    readRecord();
    window.addEventListener('popstate', readRecord);
    return () => window.removeEventListener('popstate', readRecord);
  }, []);

  useLayoutEffect(() => {
    if (!access || accessError || (communityMode && !board)) return;
    if (!activeSection) {
      setLoading(false);
      setError('');
      return;
    }
    const controller = new AbortController();
    setError('');
    if (['settings', 'applications', 'teams', 'board-settings', 'interest'].includes(section) || groupCards) {
      setList(null);
      setLoading(false);
      return;
    }
    const path = 'items?' + new URLSearchParams({
      section: section as string,
      ...(record ? { record } : { q: search, status, kind, page: String(page) }),
      ...(board ? { board } : {}),
    });
    const cached = cachedAdminRead<AdminList>(path) ?? (initial.current?.path === path ? initial.current.list : undefined);
    setList(cached ?? null);
    setLoading(!cached);
    if (initial.current?.path === path) return () => controller.abort();
    void adminRequest<AdminList>(path, undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setList(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    activeSection,
    canReadReports,
    section,
    search,
    status,
    kind,
    page,
    revision,
    access,
    accessError,
    board,
    communityMode,
    groupCards,
    record,
  ]);

  function navigate(value: typeof section | null, filter: string | null = null) {
    if (value !== section && !confirmSettingsLeave()) return;
    const url = new URL(location.href);
    url.searchParams.delete('group');
    url.searchParams.delete('application');
    url.searchParams.delete('record');
    if (value) url.searchParams.set('view', value);
    history.replaceState(null, '', url);
    setSection(value);
    setStatus(filter);
    setPage(1);
    setSelected(null);
    clearDetail();
    setKind('all');
    setQuery('');
    setSearch('');
    setSuccess('');
  }
  function clearDetail() {
    setSelected(null);
    if (!record) return;
    const url = new URL(location.href);
    url.searchParams.delete('view');
    url.searchParams.delete('record');
    history.replaceState(null, '', url);
    setRecord('');
  }

  function selectItem(item: AdminItem) {
    listScroll.current = window.scrollY;
    if (section === 'reports' || section === 'appeals' || section === 'reviews') {
      const url = new URL(location.href);
      if (board) url.searchParams.set('board', board);
      else url.searchParams.delete('board');
      url.searchParams.set('view', section);
      url.searchParams.set('record', item.id);
      history.pushState(null, '', url);
      setRecord(item.id);
    }
    setSelected(item);
    window.scrollTo(0, 0);
    requestAnimationFrame(() => detailsRef.current?.focus({ preventScroll: true }));
  }

  function returnToList() {
    const origin = new URLSearchParams(location.search).get('fromUser');
    if (origin && /^[a-zA-Z0-9-]+$/.test(origin)) {
      location.assign('/#/users/' + origin);
      return;
    }
    restoreListScroll.current = true;
    clearDetail();
  }

  useEffect(() => {
    if (!restoreListScroll.current || viewingDetail || loading || !list) return;
    const frame = requestAnimationFrame(() => {
      restoreListScroll.current = false;
      mainRef.current?.focus({ preventScroll: true });
      window.scrollTo(0, listScroll.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [viewingDetail, loading, list]);

  function completed(stay = false) {
    if (!stay) returnToList();
    if (!stay) setSuccess('操作已完成');
    setRevision((value) => value + 1);
  }
  const title = !activeSection
    ? '管理工作台'
    : isContent
      ? '内容管理'
      : restrictedUsers
        ? '受限用户'
        : sections.find((item) => item.id === section)!.title;
  const statuses =
    section === 'reports'
      ? ['all', 'pending', 'handled', 'dismissed', 'escalated']
      : section === 'appeals'
        ? ['all', 'pending', 'upheld', 'partial', 'reversed']
        : section === 'reviews'
          ? ['all', 'pending', 'approved', 'rejected']
          : [];

  return (
    <div className="admin-workspace">
      <header className="admin-topbar">
        <Link className="brand" href="/" aria-label="Umeet 首页">
          <span className="brand-initial">u</span>meet<span className="brand-dot">.</span>
        </Link>
        <span className="admin-site-label">
          <ShieldCheck size={16} /> {communityMode ? '社区工作台' : '全站后台'}
        </span>
        <div className="admin-top-actions">
          <AdminIdentity
            role={
              !access
                ? '确认权限…'
                : access.owner
                  ? '站点所有者'
                  : access.admin
                    ? '全站管理员'
                    : '社区管理人员'
            }
          />
          {!viewingDetail && !accessError && (
            <button
              className="admin-icon-button"
              aria-label="刷新数据"
              title="刷新数据"
              onClick={() => {
                if (confirmSettingsLeave()) {
                  invalidateAdminReads();
                  setRevision((value) => value + 1);
                }
              }}
              disabled={loading}
            >
              <RefreshCw size={18} />
            </button>
          )}
          <ThemeSelector />
          <Link href="/">返回社区</Link>
        </div>
      </header>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <p className="admin-eyebrow">管理工作台</p>
          {access && (
            <select
              className="admin-board-select"
              aria-label="管理社区"
              value={board}
              onChange={(event) => {
                if (!confirmSettingsLeave()) return;
                setBoard(event.target.value);
                if (!viewingDetail || section !== 'users') {
                  setSection(null);
                  setSelected(null);
                }
              }}
            >
              {!communityMode && <option value="">全部社区</option>}
              {access.boards.map((item) => (
                <option key={item.board} value={item.board}>
                  {boards.find((board) => board.slug === item.board)?.name}
                </option>
              ))}
            </select>
          )}
          <nav aria-label="管理导航">
            {sections
              .filter(
                (item) =>
                  (item.id === 'content' && (availableTabs.length > 0 || can('history'))) ||
                  (item.id === 'users' && can('users')) ||
                  (item.id === 'interest' &&
                    (Boolean(access?.admin) || can('reports') || can('content'))) ||
                  (item.id === 'wiki' && can('wiki')) ||
                  (item.id === 'team' && !grants) ||
                  (item.id === 'settings' && Boolean(access?.admin) && !communityMode) ||
                  (item.id === 'applications' && Boolean(access?.admin) && !communityMode) ||
                  (item.id === 'teams' && communityMode && boardAccess?.role === 'moderator') ||
                  (item.id === 'board-settings' &&
                    communityMode &&
                    boardAccess?.role === 'moderator' &&
                    can('boards.edit')),
              )
              .map(({ id, title, icon: Icon }) => (
                <button
                  key={id}
                  onPointerEnter={() => void warmSection(id)}
                  onFocus={() => void warmSection(id)}
                  aria-current={
                    (id === 'content' ? isContent : section === id) ? 'page' : undefined
                  }
                  onClick={() =>
                    navigate(id === 'content' ? availableTabs[0]?.id || 'history' : id)
                  }
                >
                  <Icon size={18} />
                  {communityMode && id === 'users' ? '受限用户' : title}
                  {id === 'content' && can('reports') && !!overview?.pending && (
                    <span className="admin-count">{overview.pending}</span>
                  )}
                </button>
              ))}
          </nav>
        </aside>
        <main className="admin-main" aria-label={title} tabIndex={-1} ref={mainRef}>
          {section === 'wiki' && !accessError && (
            <div className="admin-feedback">
              <Link href="/knowledge/manage">进入 Wiki 审核与管理</Link>
            </div>
          )}
          {accessError && (
            <div className="admin-feedback admin-error" role="alert">
              {accessError}
              <Link href="/">返回社区</Link>
            </div>
          )}
          {!accessError && viewingDetail ? (
            <div className="admin-record-page">
              <button className="admin-back" onClick={returnToList}>
                <ChevronLeft size={16} /> 返回
                {contentTabs.find((tab) => tab.id === section)?.title || title}
              </button>
              {error ? (
                <p role="alert" className="admin-error">
                  {error}
                </p>
              ) : detailItem ? (
                <section
                  className="admin-detail admin-detail-page"
                  tabIndex={-1}
                  ref={detailsRef}
                  aria-label="记录详情"
                >
                  <AdminDetails
                    key={detailItem.id + ':' + board}
                    item={detailItem}
                    section={
                      ['settings', 'applications', 'teams', 'board-settings', 'interest'].includes(
                        section,
                      )
                        ? 'history'
                        : (section as AdminSection)
                    }
                    board={board}
                    permissions={grants}
                    platformAdmin={Boolean(access?.admin)}
                    canManageTeam={Boolean(access?.admin || boardAccess?.role === 'owner')}
                    onComplete={completed}
                  >
                    {section === 'users' && access?.admin && detailItem.status !== 'deleted' && (
                      <UserMemberships item={detailItem} />
                    )}
                  </AdminDetails>
                </section>
              ) : (
                <p className="admin-empty" role="status">
                  {loading ? '正在加载记录…' : '此记录不存在或已移出当前范围。'}
                </p>
              )}
            </div>
          ) : (
            <>
              {error && (
                <div className="admin-feedback admin-error" role="alert">
                  {error}
                  <Link href="/">返回社区登录</Link>
                </div>
              )}
              {success && (
                <div className="admin-feedback" role="status">
                  {success}
                </div>
              )}
              {loading && !accessError && (
                <p className="admin-empty" role="status">
                  正在加载管理数据…
                </p>
              )}
              {!loading && !accessError && !activeSection && (
                <p className="admin-empty" role="status">
                  当前社区没有可用的管理页面。
                </p>
              )}
              {section === 'board-settings' && board && !accessError && (
                <CommunityBoardSettings board={board} />
              )}
              {section === 'interest' && !accessError && (
                <InterestAdmin key={board + ':' + revision} />
              )}
              {section === 'applications' && access?.admin && !communityMode && (
                <ApplicationReviews />
              )}
              {section === 'teams' && board && !accessError && (
                <CommunityTeams board={board} allowCreate={can('teams.manage')} />
              )}
              {groupCards && !accessError && <CommunityTeams board={board} allowCreate={false} />}
              {groupCards && !accessError && (
                <section aria-label="权限群组">
                  <h2 className="admin-permission-groups-heading">权限群组</h2>
                  <PermissionGroups
                    revision={revision}
                    owner={Boolean(access?.owner)}
                    onAccessChange={() => {
                      void adminRequest<ModerationAccess>('access').then(setAccess);
                    }}
                  />
                </section>
              )}
              {section === 'settings' && !accessError && access?.admin && (
                <SiteSettings revision={revision} />
              )}
              {access &&
                activeSection &&
                !['settings', 'applications', 'teams', 'board-settings', 'interest'].includes(
                  section,
                ) &&
                !groupCards &&
                !error &&
                !accessError && (
                  <>
                    {isContent && (
                      <nav className="admin-tabs" aria-label="内容管理视图">
                        {availableTabs.map((tab) => (
                          <button
                            key={tab.id}
                            aria-current={section === tab.id ? 'page' : undefined}
                            onClick={() => navigate(tab.id)}
                          >
                            {tab.title}
                          </button>
                        ))}
                        {can('history') && (
                          <button
                            type="button"
                            aria-current={section === 'history' ? 'page' : undefined}
                            onClick={() => navigate('history')}
                          >
                            {board ? '社区管理记录' : '全站管理记录'}
                          </button>
                        )}
                      </nav>
                    )}
                    {section === 'users' && (
                      <nav className="admin-tabs" aria-label="用户分类">
                        {(restrictedUsers ? restrictedUserTabs : userTabs).map(([value, label]) => (
                          <button
                            key={value}
                            aria-current={status === value ? 'page' : undefined}
                            onClick={() => navigate('users', value)}
                          >
                            {label}
                          </button>
                        ))}
                      </nav>
                    )}
                    <form
                      key={section}
                      className="admin-filters"
                      onSubmit={(event) => {
                        event.preventDefault();
                        setSearch(query);
                        setPage(1);
                        setSelected(null);
                      }}
                    >
                      <label className="admin-search">
                        <Search size={17} />
                        <input
                          aria-label="搜索管理数据"
                          placeholder={
                            section === 'users' ? '搜索用户名或昵称' : '搜索内容、用户名或原因'
                          }
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          maxLength={100}
                        />
                      </label>
                      <button type="submit">搜索</button>
                      {statuses.length > 0 && (
                        <label className="admin-filter-label">
                          状态
                          <select
                            aria-label="筛选状态"
                            value={status}
                            onChange={(event) => {
                              setStatus(event.target.value);
                              setPage(1);
                              setSelected(null);
                            }}
                          >
                            {statuses.map((value) => (
                              <option key={value} value={value}>
                                {value === 'all' ? '全部状态' : adminStatus[value]}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {section === 'reports' && (
                        <label className="admin-filter-label">
                          类型
                          <select
                            aria-label="筛选类型"
                            value={kind}
                            onChange={(event) => {
                              setKind(event.target.value);
                              setPage(1);
                              setSelected(null);
                            }}
                          >
                            <option value="all">所有类型</option>
                            {['user', 'post', 'reply', 'message', 'wiki'].map((value) => (
                              <option value={value} key={value}>
                                {targetTypes[value]}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </form>
                    {!loading && list && (
                      <div className="admin-results">
                        <section className="admin-list" aria-label={title}>
                          <div className="admin-list-label">共 {list.total} 条记录</div>
                          {list.items.length === 0 && (
                            <div className="admin-empty">
                              {restrictedUsers && !search && status === 'restricted'
                                ? '当前社区没有受限用户'
                                : section === 'reports' &&
                                    !search &&
                                    status === 'pending' &&
                                    kind === 'all'
                                  ? '暂无待处理举报'
                                  : search || status !== 'all' || kind !== 'all'
                                    ? '没有符合条件的记录'
                                    : '这里暂时没有记录'}
                            </div>
                          )}
                          {section === 'users' && list.items.length > 0 && (
                            <div className="admin-table-scroll">
                              <table
                                className={
                                  'admin-user-table' +
                                  (restrictedUsers ? ' admin-restricted-table' : '')
                                }
                              >
                                <thead>
                                  <tr>
                                    <th>用户</th>
                                    <th>状态</th>
                                    <th>{restrictedUsers ? '限制原因' : '最后活动'}</th>
                                    <th>{restrictedUsers ? '到期时间' : '注册时间'}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {list.items.map((item) => (
                                    <tr
                                      key={item.id}
                                      aria-current={detailItem?.id === item.id ? 'true' : undefined}
                                    >
                                      <td>
                                        <div className="admin-user-identity">
                                          {item.status !== 'deleted' && item.href ? (
                                            <a
                                              className="admin-user-avatar"
                                              href={item.href}
                                              target="_blank"
                                              rel="noreferrer"
                                              aria-label={'查看 ' + item.title + ' 的个人主页'}
                                            >
                                              {Array.from(item.title)[0]?.toLocaleUpperCase() ||
                                                '·'}
                                            </a>
                                          ) : (
                                            <span className="admin-user-avatar" aria-hidden="true">
                                              ·
                                            </span>
                                          )}
                                          <div>
                                            <button
                                              className="admin-user-link"
                                              type="button"
                                              onClick={() => selectItem(item)}
                                              title={item.title}
                                              aria-label={'管理用户 ' + item.title}
                                            >
                                              {item.title}
                                            </button>
                                            {item.handle && item.handle !== item.title && (
                                              <small>@{item.handle}</small>
                                            )}
                                          </div>
                                        </div>
                                      </td>
                                      <td>
                                        {restrictedUsers ? (
                                          <>
                                            {item.muted && (
                                              <span className="admin-badge restricted">
                                                限制参与
                                              </span>
                                            )}
                                            {item.suspended && (
                                              <span className="admin-badge restricted">已停用</span>
                                            )}
                                          </>
                                        ) : (
                                          <span className={'admin-badge ' + item.status}>
                                            {
                                              adminStatus[
                                                item.suspended
                                                  ? 'suspended'
                                                  : item.muted
                                                    ? 'muted'
                                                    : item.status
                                              ]
                                            }
                                          </span>
                                        )}
                                        {item.staff && <small>管理人员</small>}
                                      </td>
                                      <td
                                        className={
                                          restrictedUsers
                                            ? 'admin-restriction-reason'
                                            : 'admin-user-date'
                                        }
                                      >
                                        {restrictedUsers
                                          ? item.body || '—'
                                          : item.lastSeenAt
                                            ? adminShortDate(item.lastSeenAt)
                                            : '—'}
                                      </td>
                                      <td className="admin-user-date">
                                        {restrictedUsers ? (
                                          <>
                                            {item.until && (
                                              <div>禁言 · {adminDate(item.until)}</div>
                                            )}
                                            {item.penalties
                                              ?.filter((penalty) =>
                                                [
                                                  'publish',
                                                  'suspension',
                                                  'participation',
                                                  'deactivation',
                                                ].includes(penalty.capability),
                                              )
                                              .map((penalty) => (
                                                <div key={penalty.id}>
                                                  {['publish', 'participation'].includes(
                                                    penalty.capability,
                                                  )
                                                    ? '限制参与'
                                                    : '停用账号'}{' '}
                                                  ·{' '}
                                                  {penalty.until
                                                    ? adminDate(penalty.until)
                                                    : '永久'}
                                                </div>
                                              ))}
                                          </>
                                        ) : (
                                          adminShortDate(item.createdAt)
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {isContent && list.items.length > 0 && (
                            <div className="admin-table-scroll">
                              <table className="admin-queue-table">
                                <thead>
                                  <tr>
                                    <th>对象</th>
                                    <th>类型</th>
                                    <th>状态</th>
                                    <th>时间</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {list.items.map((item) => (
                                    <tr key={item.id}>
                                      <td>
                                        <button
                                          type="button"
                                          className="admin-user-link"
                                          onClick={() => selectItem(item)}
                                        >
                                          {item.title}
                                        </button>
                                        {(item.reason || item.body) && (
                                          <small>
                                            {[
                                              section === 'history' ? item.author : '',
                                              item.reason || item.body,
                                            ]
                                              .filter(Boolean)
                                              .join(' · ')}
                                          </small>
                                        )}
                                      </td>
                                      <td>
                                        {section === 'history'
                                          ? actionNames[item.kind] || item.kind
                                          : targetTypes[item.kind] || item.kind}
                                      </td>
                                      <td>
                                        <span className={'admin-badge ' + item.status}>
                                          {section === 'trash'
                                            ? '已删除'
                                            : adminStatus[item.status] || item.status}
                                        </span>
                                      </td>
                                      <td>
                                        <time dateTime={item.createdAt}>
                                          {adminDate(item.createdAt)}
                                        </time>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {section !== 'users' &&
                            !isContent &&
                            list.items.map((item) => (
                              <button
                                className="admin-row"
                                key={item.id}
                                onClick={() => selectItem(item)}
                              >
                                <div className="admin-row-top">
                                  <span className="admin-kind">{targetTypes[item.kind]}</span>
                                  <span className={'admin-badge ' + item.status}>
                                    {item.protected ? '已保护 · ' : ''}
                                    {adminStatus[item.status] || item.status}
                                  </span>
                                </div>
                                <h2>
                                  {item.title} <ChevronRight size={16} />
                                </h2>

                                <p>
                                  {item.reports?.[0]?.reason ||
                                    item.reason ||
                                    item.body ||
                                    '点击查看详情'}
                                </p>
                                <small>
                                  {item.reports && item.reports.length > 1
                                    ? item.reports.length + ' 条举报已合并'
                                    : item.reporter
                                      ? '举报人 ' + item.reporter
                                      : item.author}{' '}
                                  · {adminDate(item.createdAt)}
                                </small>
                              </button>
                            ))}
                          {list.total > 0 && (
                            <footer className="admin-pagination">
                              <span>
                                第 {page} / {Math.max(1, Math.ceil(list.total / 25))} 页
                              </span>
                              <button
                                aria-label="上一页"
                                disabled={page <= 1}
                                onClick={() => {
                                  setPage(page - 1);
                                  setSelected(null);
                                }}
                              >
                                <ChevronLeft size={17} />
                              </button>
                              <button
                                aria-label="下一页"
                                disabled={page * 25 >= list.total}
                                onClick={() => {
                                  setPage(page + 1);
                                  setSelected(null);
                                }}
                              >
                                <ChevronRight size={17} />
                              </button>
                            </footer>
                          )}
                        </section>
                      </div>
                    )}
                  </>
                )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
