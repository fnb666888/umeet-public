'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  AdminAction,
  DispositionInput,
  AdminItem,
  AdminSection,
  ModerationPermission,
} from '../../../../../packages/contracts/src/admin';
import { permits } from '../../../../../packages/contracts/src/moderation-permissions';
import { adminRequest } from './admin-api';
import { WikiComparison } from './WikiComparison';
import { BusinessControls, type ActionChoice } from './BusinessControls';
import { DispositionEffects, dispositionScope } from '../DispositionEffects';

type Choice = ActionChoice;

const reportKinds: Record<string, string> = {
  post: '帖子',
  reply: '回复',
  profile: '个人资料',
  account: '账号行为',
  message: '私信',
  wiki: 'Wiki',
};

function profileLink(name: string, id?: string) {
  return id && name !== '已注销用户' ? (
    <a href={'/#/users/' + encodeURIComponent(id)} target="_blank" rel="noreferrer">
      {name} ↗
    </a>
  ) : (
    name
  );
}

function dateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export function AdminDetails({
  item,
  section,
  onComplete,
  board,
  canManageTeam,
  permissions,
  platformAdmin,
  children,
}: {
  item: AdminItem;
  section: AdminSection;
  onComplete: (stay?: boolean) => void;
  board: string;
  canManageTeam: boolean;
  platformAdmin: boolean;
  permissions?: ModerationPermission[] | undefined;
  children?: React.ReactNode;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [accountActionsOpen, setAccountActionsOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [context, setContext] = useState<{
    contributions: number;
    records: { id: string; action: string; author: string; reason: string; createdAt: string }[];
  } | null>(null);
  const [contextError, setContextError] = useState('');
  const can = (permission: ModerationPermission) => permits(permissions, permission);
  const canReadHistory = can('history');
  const canHide = can('content.delete');
  const canRestrict = can('users.manage');
  const queue = section === 'reports' || section === 'appeals' || section === 'reviews';
  const [customDuration, setCustomDuration] = useState(false);
  const duration =
    choice?.action === 'disposition'
      ? choice.disposition.kind === 'warning'
        ? undefined
        : choice.disposition
      : choice?.action === 'case.resolve' && choice.authorDisposition
        ? choice.authorDisposition.kind === 'warning'
          ? undefined
          : choice.authorDisposition
        : choice?.action === 'penalty'
          ? choice
          : choice?.action === 'case.resolve'
            ? choice.accountPenalty
            : undefined;
  const optionalReason =
    choice?.action === 'case.escalate' ||
    (choice?.action === 'case.resolve' && choice.outcome === 'dismissed');
  useEffect(() => {
    if (section !== 'users' || !canReadHistory || !item.authorId) return;
    const controller = new AbortController();
    void adminRequest<NonNullable<typeof context>>(
      'context?' + new URLSearchParams({ user: item.authorId, ...(board ? { board } : {}) }),
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setContext(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setContextError(error.message);
      });
    return () => controller.abort();
  }, [item.authorId, section, board, canReadHistory, queue]);
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  function choose(value: Choice) {
    setChoice(value);
    setCustomDuration(false);
    setReason('');
    setNotice('');
    setError('');
    requestAnimationFrame(() => reasonRef.current?.focus());
  }
  async function chooseQueueAction(value: Choice) {
    if (section !== 'reports' || !canRestrict || !item.authorId) {
      choose(value);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const penalties = await adminRequest<NonNullable<AdminItem['penalties']>>(
        'dispositions?' +
          new URLSearchParams({
            user: item.authorId,
            ...(board && !platformAdmin ? { board } : {}),
          }),
      );
      setAuthorPenalties(penalties);
      if (value.action === 'case.resolve' && value.authorDisposition) {
        const kind = value.authorDisposition.kind;
        value = {
          ...value,
          authorDisposition: {
            ...value.authorDisposition,
            expectedVersion:
              penalties.find((penalty) => penalty.capability === kind && !penalty.board)?.id ||
              null,
          },
        };
      }
      choose(value);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const [authorPenalties, setAuthorPenalties] = useState<NonNullable<AdminItem['penalties']>>([]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!choice || busy) return;
    const payload = { ...choice, reason: reason.trim() };
    const fingerprint = JSON.stringify(payload);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      await adminRequest('actions' + (board ? '?board=' + board : ''), {
        ...payload,
        id: pending.current.id,
      });
      const stay =
        section === 'reports' && (choice.action === 'penalty' || choice.action === 'visibility');
      if (stay) {
        setChoice(null);
        setReason('');
        setNotice('处置已记录');
      }
      onComplete(stay);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const labels: Record<string, string> = {
    disposition: choice?.action === 'disposition' ? ({ warning: '警告此用户', participation: '限制此用户参与', deactivation: '停用此账号' }[choice.disposition.kind]) : '确认用户处置',
    penalty: '确认账号处置',
    'penalty.revoke': '解除选定处置',
    'appeal.review': '确认申诉复核',
    'case.escalate': '升级全站处理',
    'content.label': '保存内容标记',
    'wiki.manage': '保存 Wiki 管理规则',
    visibility: '恢复内容',
    report:
      choice?.action === 'report' && choice.outcome === 'dismissed' ? '驳回举报' : '标记已处理',
    restriction: choice?.action === 'restriction' && !choice.hours ? '解除禁言' : '确认禁言',
    'wiki.restore': '恢复选定版本',
    'case.resolve':
      choice?.action === 'case.resolve' && choice.outcome === 'dismissed' ? '驳回举报' : '确认结案',
    'post.review': '提交审核结果',
    'wiki.protect': '调整页面保护',
    'post.settings': '确认调整帖子',
    'member.role': '确认调整权限',
    note: '保存内部备注',
  };
  const penaltyLabels = {
    warning: '正式警告',
    publish: '禁言',
    messages: '限制私信',
    wiki: '限制 Wiki 编辑',
    profile: '限制修改资料',
    suspension: board ? '社区封禁' : '账号封禁',
  };
  function userDisposition(kind: DispositionInput['kind']): Choice {
    const active = item.penalties?.find(
      (penalty) => penalty.capability === kind && (penalty.board || '') === board,
    );
    return {
      action: 'disposition',
      target: item.target,
      disposition: {
        kind,
        scope: board ? 'community' : 'global',
        ...(board ? { board: board as 'daily' } : {}),
        hours: 24,
        expectedVersion: active?.id || null,
      },
    };
  }
  const queueActions: { label: string; choice: Choice; group?: string }[] = [];
  if (queue && item.status === 'pending' && item.manageable !== false) {
    if (section === 'reviews') {
      queueActions.push(
        {
          label: '通过并发布',
          choice: { action: 'post.review', target: item.id, outcome: 'approved' },
        },
        {
          label: '不予发布',
          choice: { action: 'post.review', target: item.id, outcome: 'rejected' },
        },
      );
    } else if (section === 'appeals' && can('appeals.review')) {
      queueActions.push(
        {
          label: '维持原处置',
          choice: { action: 'appeal.review', target: item.id, outcome: 'upheld' },
        },
        {
          label: '通过申诉并撤销处置',
          choice: { action: 'appeal.review', target: item.id, outcome: 'reversed' },
        },
      );
    } else if (section === 'reports') {
      const resolve = (outcome: 'handled' | 'dismissed'): Choice => ({
        action: 'case.resolve',
        target: item.target,
        reportIds: item.reportIds || [item.id],
        outcome,
        hidden: false,
        hours: 0,
      });
      if (can('reports.dismiss'))
        queueActions.push({ label: '保留内容', choice: resolve('dismissed') });
      if (['post', 'reply'].includes(item.kind)) {
        if (canHide && item.contentHidden !== undefined)
          queueActions.push({
            label: '删除内容',
            choice: { ...resolve('handled'), hidden: true } as Choice,
          });
      } else if (['account', 'profile'].includes(item.kind)) {
        if (platformAdmin && item.authorId && item.author !== '已注销用户') {
          for (const kind of ['warning', 'participation', 'deactivation'] as const)
            queueActions.push({
              label:
                kind === 'warning'
                  ? '警告并结案'
                  : kind === 'participation'
                    ? '限制参与并结案'
                    : '停用账号并结案',
              choice: {
                ...resolve('handled'),
                authorDisposition: { kind, scope: 'global', hours: 24, expectedVersion: null },
              } as Choice,
            });
        } else if (board && can('reports.escalate')) {
          queueActions.push({
            label: '转交全站管理员',
            choice: { action: 'case.escalate', target: item.target },
          });
        }
      } else if (can(item.kind === 'wiki' ? 'wiki.edit' : 'content.delete')) {
        queueActions.push({ label: '标记已处理', choice: resolve('handled') });
      }
    }
  }
  if (section === 'trash' && can('content.restore') && item.manageable !== false)
    queueActions.push({
      label: '恢复内容',
      choice: { action: 'visibility', target: item.target, hidden: false },
    });
  const split = section === 'users' || section === 'appeals';
  function updateDuration(hours: number) {
    if (choice?.action === 'disposition')
      setChoice({ ...choice, disposition: { ...choice.disposition, hours: hours || null } });
    if (choice?.action === 'case.resolve' && choice.authorDisposition)
      setChoice({
        ...choice,
        authorDisposition: { ...choice.authorDisposition, hours: hours || null },
      });
    if (choice?.action === 'penalty') setChoice({ ...choice, hours });
    if (choice?.action === 'case.resolve' && choice.accountPenalty)
      setChoice({ ...choice, accountPenalty: { ...choice.accountPenalty, hours } });
  }
  return (
    <div className={split ? 'admin-detail-grid' : undefined}>
      <header className="admin-detail-heading">
        <p className="admin-eyebrow">
          {section === 'reports'
            ? '举报详情'
            : section === 'appeals'
              ? '申诉详情'
              : section === 'reviews'
                ? '首帖审核'
                : section === 'users'
                  ? '账号摘要'
                  : '记录详情'}
        </p>
        <h1>{item.title}</h1>
        {section === 'reports' && (
          <span className={'admin-badge ' + item.status}>
            {item.status === 'handled'
              ? '已结案'
              : item.status === 'dismissed'
                ? '已驳回'
                : item.status === 'escalated'
                  ? '已转交'
                  : '待处理'}
          </span>
        )}

        {section === 'users' && item.handle && item.handle !== item.title && (
          <p className="admin-help">@{item.handle}</p>
        )}
      </header>
      <div className="admin-detail-evidence">
        {section === 'users' && (
          <div className="admin-user-detail-status">
            <span className={'admin-badge ' + item.status}>
              {item.status === 'deleted'
                ? '已注销'
                : item.suspended
                  ? '已停用'
                  : item.muted
                    ? '限制参与'
                    : item.status === 'restricted'
                      ? '受限中'
                      : '正常'}
            </span>
            {item.penalties
              ?.filter((penalty) => ['participation', 'deactivation'].includes(penalty.capability))
              .map((penalty) => (
                <span className="admin-badge" key={penalty.id}>
                  {penalty.capability === 'participation' ? '限制参与' : '停用账号'} ·{' '}
                  {dispositionScope(penalty.board)} ·{' '}
                  {penalty.until ? dateTime(penalty.until) + ' 到期' : '永久'}
                </span>
              ))}
            {item.staff && <span className="admin-badge">管理人员</span>}
            {canRestrict && item.manageable !== false && item.status !== 'deleted' && (
              <div className="admin-account-actions">
                <button
                  type="button"
                  aria-expanded={accountActionsOpen}
                  onClick={() => setAccountActionsOpen(!accountActionsOpen)}
                >
                  账号操作
                </button>
                {accountActionsOpen && (
                  <div className="admin-account-action-menu">
                    {(platformAdmin && !board
                      ? (['warning', 'participation', 'deactivation'] as const)
                      : (['warning', 'participation'] as const)
                    ).map((kind) => {
                      const active = item.penalties?.find(
                        (penalty) => penalty.capability === kind && (penalty.board || '') === board,
                      );
                      const label =
                        kind === 'warning'
                          ? '警告用户'
                          : kind === 'deactivation'
                            ? '停用账号'
                            : '限制参与';
                      return (
                        <div key={kind}>
                          <button
                            type="button"
                            disabled={busy}
                            className={kind === 'deactivation' ? 'admin-danger-action' : undefined}
                            onClick={() => {
                              setAccountActionsOpen(false);
                              choose(userDisposition(kind));
                            }}
                          >
                            {active && kind !== 'warning' ? '调整' + label : label}
                          </button>
                          {active && kind !== 'warning' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setAccountActionsOpen(false);
                                choose({
                                  action: 'penalty.revoke',
                                  target: active.id,
                                  expectedVersion: active.id,
                                });
                              }}
                            >
                              解除{label}
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {platformAdmin &&
                      !board &&
                      item.penalties
                        ?.filter(
                          (penalty) => penalty.board && penalty.capability === 'participation',
                        )
                        .map((penalty) => (
                          <div key={penalty.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setAccountActionsOpen(false);
                                choose({
                                  action: 'disposition',
                                  target: item.target,
                                  disposition: {
                                    kind: 'participation',
                                    scope: 'community',
                                    board: penalty.board as 'daily',
                                    hours: 24,
                                    expectedVersion: penalty.id,
                                  },
                                });
                              }}
                            >
                              调整{dispositionScope(penalty.board)}限制
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAccountActionsOpen(false);
                                choose({
                                  action: 'penalty.revoke',
                                  target: penalty.id,
                                  expectedVersion: penalty.id,
                                });
                              }}
                            >
                              解除{dispositionScope(penalty.board)}限制
                            </button>
                          </div>
                        ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {!!item.effects?.length && <DispositionEffects effects={item.effects} />}
        {item.originalAction && (
          <section className="admin-report-reason">
            <h3>原处置记录</h3>
            <p>
              {item.originalAction.actor} ·{' '}
              {new Date(item.originalAction.createdAt).toLocaleString('zh-CN')}
            </p>
            <p>{item.originalAction.reason}</p>
          </section>
        )}
        <dl className="admin-metadata">
          {item.author && section !== 'users' && (
            <>
              <dt>
                {section === 'reports'
                  ? '被举报人'
                  : section === 'history'
                    ? '操作人'
                    : section === 'appeals'
                      ? '申诉人'
                      : '作者'}
              </dt>
              <dd>
                {section === 'reports' ? profileLink(item.author, item.authorId) : item.author}
              </dd>
            </>
          )}
          {item.reporter && !item.reports && (
            <>
              <dt>举报人</dt>
              <dd>{item.reporter}</dd>
            </>
          )}
          {section === 'reports' ? (
            <>
              <dt>举报对象</dt>
              <dd>
                {reportKinds[item.kind] || item.kind}
                {item.contentHidden && ' · 已移除展示'}
              </dd>
              {item.publishedAt && (
                <>
                  <dt>{item.kind === 'message' ? '发送时间' : '发布时间'}</dt>
                  <dd>{dateTime(item.publishedAt)}</dd>
                </>
              )}
            </>
          ) : (
            <>
              <dt>
                {section === 'users' ? '注册时间' : section === 'history' ? '操作时间' : '提交时间'}
              </dt>
              <dd>{dateTime(item.createdAt)}</dd>
            </>
          )}
          {section === 'users' && item.lastSeenAt && (
            <>
              <dt>最后活动</dt>
              <dd>{new Date(item.lastSeenAt).toLocaleString('zh-CN', { hour12: false })}</dd>
            </>
          )}
          {item.until && (
            <>
              <dt>禁言到期</dt>
              <dd>{new Date(item.until).toLocaleString('zh-CN', { hour12: false })}</dd>
            </>
          )}
        </dl>
        {!!item.reports?.length && (
          <section className="admin-report-reason">
            {item.reports.map((report) => {
              const separator = report.reason.indexOf(' · ');
              const category =
                report.categoryLabel || (separator >= 0 ? report.reason.slice(0, separator) : '');
              const detail = report.categoryLabel
                ? report.detail
                : separator >= 0
                  ? report.reason.slice(separator + 3)
                  : report.reason;
              return (
                <article key={report.id}>
                  <div className="admin-report-byline">
                    <span>
                      举报人 <strong>{profileLink(report.reporter, report.reporterId)}</strong>
                    </span>
                    <small>举报时间 {dateTime(report.createdAt)}</small>
                  </div>
                  <dl className="admin-metadata">
                    <dt>举报类型</dt>
                    <dd>{category || '未单独记录'}</dd>
                    <dt>举报原因</dt>
                    <dd>{detail || '无补充说明'}</dd>
                  </dl>
                </article>
              );
            })}
          </section>
        )}
        {item.reason && !item.reports && (
          <div className="admin-report-reason">
            <h3>{section === 'appeals' ? '申诉说明' : '举报原因'}</h3>
            <p>{item.reason}</p>
          </div>
        )}
        {item.restorations?.map((entry) => (
          <p key={entry.id}>
            内容已恢复 · {entry.author} · {dateTime(entry.createdAt)} · {entry.reason}
          </p>
        ))}
        {item.resolution && (
          <div className="admin-report-reason">
            <h3>处理结论</h3>
            <p>{item.resolution}</p>
          </div>
        )}
        {section !== 'wiki' &&
          section !== 'appeals' &&
          ((section !== 'reports' && section !== 'users') || item.body) && (
            <div className="admin-original">
              <h3>
                {section === 'history'
                  ? '处理原因'
                  : section === 'users'
                    ? '当前限制原因'
                    : '内容原文'}
              </h3>
              <p>{item.body || '暂无内容'}</p>
            </div>
          )}
        {item.href &&
          item.status !== 'deleted' &&
          !(section === 'reports' && ['profile', 'account'].includes(item.kind)) && (
            <a className="admin-source-link" href={item.href} target="_blank" rel="noreferrer">
              {section === 'users' ? '查看个人主页' : '查看原文'} ↗
            </a>
          )}
        {!!item.images?.length && (
          <div className="admin-images">
            {item.images.map((src) => (
              <a key={src} href={src} target="_blank" rel="noreferrer">
                <img src={src} alt="内容附图" />
              </a>
            ))}
          </div>
        )}
        {item.wiki && (
          <WikiComparison
            wiki={item.wiki}
            manageable={item.manageable !== false}
            onRestore={(revision) =>
              choose({
                action: 'wiki.restore',
                target: item.target,
                revision,
                baseRevision: item.wiki!.revisions,
              })
            }
          />
        )}
        {item.wiki && item.manageable === false && (
          <p>该词条关联多个社区，需要全部关联社区管理权限才能调整。</p>
        )}
        {context && (
          <details className="admin-user-context">
            <summary>处置历史（{context.records.length}）</summary>
            {context.records.length === 0 && <p>暂无账号处置</p>}
            {context.records.map((record) => (
              <article key={record.id}>
                <strong>
                  {record.action === 'warning'
                    ? '警告用户'
                    : record.action === 'participation'
                      ? '限制参与'
                      : record.action === 'deactivation'
                        ? '停用账号'
                        : record.action === 'participation.expired'
                          ? '参与限制到期'
                          : record.action === 'deactivation.expired'
                            ? '账号停用到期'
                            : record.action === 'mute'
                              ? '禁言'
                              : record.action === 'suspend'
                                ? '封禁'
                                : record.action === 'mute.expired'
                                  ? '禁言到期'
                                  : record.action === 'suspend.expired'
                                    ? '封禁到期'
                                    : record.action === 'penalty.revoke'
                                      ? '解除处置'
                                      : record.action === 'case.resolve'
                                        ? '举报处置'
                                        : record.action === 'restriction'
                                          ? '调整禁言'
                                          : '账号处置'}{' '}
                  · {record.author}
                </strong>
                <p>{record.reason}</p>
                <small>{new Date(record.createdAt).toLocaleString('zh-CN')}</small>
              </article>
            ))}
          </details>
        )}
        {contextError && <p className="admin-error">{contextError}</p>}
      </div>
      <div className="admin-detail-tools">
        {!queue && section !== 'users' && !busy && (section !== 'wiki' || can('wiki.edit')) && (
          <BusinessControls item={item} section={section} board={board} choose={choose} />
        )}
        {children}
        {queueActions.length > 0 && (
          <section className="admin-queue-controls">
            <h3>
              {section === 'trash' ? '回收站操作' : section === 'appeals' ? '复核决定' : '处理结果'}
            </h3>
            <div className="admin-detail-actions">
              {queueActions.map(({ label, choice: action }) => (
                <button key={label} disabled={busy} onClick={() => void chooseQueueAction(action)}>
                  {label}
                </button>
              ))}
            </div>
          </section>
        )}
        {!queue &&
          !busy &&
          item.manageable !== false &&
          ((section === 'wiki' && can('wiki.edit')) ||
            (section === 'team' && canManageTeam && board)) && (
            <div className="admin-detail-actions">
              {section === 'wiki' && (
                <button
                  onClick={() =>
                    choose({
                      action: 'wiki.protect',
                      target: item.target,
                      protected: !item.protected,
                    })
                  }
                >
                  {item.protected ? '解除页面保护' : '保护页面'}
                </button>
              )}
              {section === 'team' && canManageTeam && board && (
                <button
                  onClick={() =>
                    choose({ action: 'member.role', target: item.target, role: 'remove' })
                  }
                >
                  移除管理权限
                </button>
              )}
            </div>
          )}
        {notice && <p role="status">{notice}</p>}
        {choice && (
          <form className="admin-confirm" onSubmit={submit}>
            {choice.action === 'disposition' && <div className="admin-disposition-summary">
              <strong>处置账号：{item.title}</strong>
              <p>范围：{dispositionScope(choice.disposition.board)}</p>
              <p>期限：{choice.disposition.kind === 'warning' ? '记录警告，不限制账号使用' : choice.disposition.hours === null ? '永久（需手动解除）' : choice.disposition.hours + ' 小时'}</p>
              <p>{choice.disposition.kind === 'deactivation' ? '生效后，该账号将无法正常参与全站社区活动，仍可按规则申诉。' : choice.disposition.kind === 'participation' ? '生效后，该用户在上述范围内的参与能力将受到限制。' : '此警告会记录在用户的管理记录中。'}</p>
            </div>}
            {choice.action === 'disposition' && (
              <p>
                {dispositionScope(choice.disposition.board)} ·{' '}
                {choice.disposition.kind === 'warning'
                  ? '警告用户'
                  : choice.disposition.kind === 'deactivation'
                    ? '停用账号'
                    : '限制参与'}
              </p>
            )}
            <h3>
              {choice.action === 'case.resolve' && choice.hidden
                ? '删除内容并结案'
                : choice.action === 'case.resolve' && choice.accountPenalty
                  ? penaltyLabels[choice.accountPenalty.capability] + '并结案'
                  : labels[choice.action]}
            </h3>
            {choice.action === 'case.resolve' && choice.hidden && canRestrict && (
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(choice.authorDisposition)}
                  onChange={(event) => {
                    const scopeBoard = platformAdmin ? undefined : board;
                    setChoice({
                      ...choice,
                      authorDisposition: event.target.checked
                        ? {
                            kind: 'participation',
                            scope: platformAdmin ? 'global' : 'community',
                            ...(!platformAdmin ? { board: board as 'daily' } : {}),
                            hours: 24,
                            expectedVersion:
                              authorPenalties.find(
                                (penalty) =>
                                  penalty.capability === 'participation' &&
                                  (penalty.board || undefined) === scopeBoard,
                              )?.id || null,
                          }
                        : undefined,
                    });
                  }}
                />
                同时限制作者参与
              </label>
            )}
            {platformAdmin &&
              choice.action === 'case.resolve' &&
              choice.authorDisposition?.kind === 'participation' &&
              item.boards?.[0] && (
                <label>
                  限制范围
                  <select
                    value={choice.authorDisposition.scope}
                    onChange={(event) => {
                      const scopeBoard =
                        event.target.value === 'community' ? item.boards![0] : undefined;
                      setChoice({
                        ...choice,
                        authorDisposition: {
                          ...choice.authorDisposition!,
                          scope: event.target.value as 'global' | 'community',
                          board: scopeBoard as 'daily' | undefined,
                          expectedVersion:
                            authorPenalties.find(
                              (penalty) =>
                                penalty.capability === 'participation' &&
                                (penalty.board || undefined) === scopeBoard,
                            )?.id || null,
                        },
                      });
                    }}
                  >
                    <option value="global">全站</option>
                    <option value="community">内容所在社区</option>
                  </select>
                </label>
              )}
            {choice.action === 'appeal.review' && item.effects?.length ? (
              <section className="admin-appeal-decisions">
                {item.effects.map((effect) => (
                  <div key={effect.id}>
                    <label>
                      {effect.type === 'content.delete'
                        ? '内容删除'
                        : effect.type === 'warning'
                          ? '警告'
                          : effect.type === 'deactivation'
                            ? '停用账号'
                            : '限制参与'}{' '}
                      · {dispositionScope(effect.board)}
                      <select
                        value={
                          choice.decisions?.find((decision) => decision.effectId === effect.id)
                            ?.outcome || choice.outcome
                        }
                        onChange={(event) => {
                          const decisions = item.effects!.map(
                            (item) =>
                              choice.decisions?.find(
                                (decision) => decision.effectId === item.id,
                              ) || { effectId: item.id, outcome: choice.outcome },
                          );
                          setChoice({
                            ...choice,
                            decisions: decisions.map((decision) =>
                              decision.effectId === effect.id
                                ? {
                                    ...decision,
                                    outcome: event.target.value as 'upheld' | 'reversed',
                                  }
                                : decision,
                            ),
                          });
                        }}
                      >
                        <option value="upheld">维持处置</option>
                        <option value="reversed">
                          {effect.type === 'content.delete' ? '恢复内容' : '撤销处置'}
                        </option>
                      </select>
                    </label>
                    {effect.currentVersion && effect.currentVersion !== effect.penaltyId && (
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(
                            choice.decisions?.find((decision) => decision.effectId === effect.id)
                              ?.releaseCurrentVersion,
                          )}
                          onChange={(event) => {
                            const decisions = item.effects!.map(
                              (item) =>
                                choice.decisions?.find(
                                  (decision) => decision.effectId === item.id,
                                ) || { effectId: item.id, outcome: choice.outcome },
                            );
                            setChoice({
                              ...choice,
                              decisions: decisions.map((decision) =>
                                decision.effectId === effect.id
                                  ? {
                                      ...decision,
                                      releaseCurrentVersion: event.target.checked
                                        ? effect.currentVersion!
                                        : undefined,
                                      outcome: 'reversed',
                                    }
                                  : decision,
                              ),
                            });
                          }}
                        />
                        已有后续处置，同时解除当前限制
                      </label>
                    )}
                  </div>
                ))}
              </section>
            ) : null}
            {duration && (
              <>
                <label>
                  有效期
                  <select
                    value={customDuration ? 'custom' : duration.hours || 0}
                    onChange={(event) => {
                      const value = event.target.value;
                      setCustomDuration(value === 'custom');
                      updateDuration(value === 'custom' ? 24 : Number(value));
                    }}
                  >
                    <option value={24}>1 天</option>
                    <option value={168}>7 天</option>
                    <option value={720}>30 天</option>
                    <option value="custom">自定义</option>
                    {(choice.action === 'disposition' ||
                      (choice.action === 'case.resolve' && choice.authorDisposition) ||
                      platformAdmin) && <option value={0}>永久</option>}
                  </select>
                </label>
                {customDuration && (
                  <label>
                    小时数
                    <input
                      type="number"
                      min={1}
                      max={8760}
                      required
                      value={duration.hours || ''}
                      onChange={(event) => updateDuration(Number(event.target.value))}
                    />
                  </label>
                )}
              </>
            )}
            <label>
              {optionalReason ? '处理原因（选填）' : '处理原因'}
              <textarea
                ref={reasonRef}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={optionalReason ? undefined : 2}
                maxLength={500}
                required={!optionalReason}
                disabled={busy}
                placeholder="说明处理依据"
              />
            </label>
            {error && (
              <p className="admin-error" role="alert">
                {error}
              </p>
            )}
            <div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setChoice(null);
                }}
              >
                取消
              </button>
              <button
                type="submit"
                className={'admin-primary' + (choice.action === 'disposition' && choice.disposition.kind === 'deactivation' ? ' admin-danger-action' : '')}
                disabled={busy || (!optionalReason && reason.trim().length < 2)}
              >
                {busy ? '正在处理…' : labels[choice.action] || '提交处理结果'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
