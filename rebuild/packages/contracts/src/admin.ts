import { z } from 'zod';
import type { DemoWiki } from './community.js';
import { DemoBoard } from './community.js';
import { ReportReasonId } from './site-settings.js';

const optionalReason = z.string().trim().max(500).default('');
const reason = z.string().trim().min(2).max(500);
export const DispositionInput = z
  .strictObject({
    kind: z.enum(['warning', 'participation', 'deactivation']),
    scope: z.enum(['global', 'community']),
    board: DemoBoard.optional(),
    hours: z.number().int().min(1).max(8760).nullable(),
    expectedVersion: z.string().nullable(),
  })
  .refine((value) => (value.scope === 'community') === Boolean(value.board))
  .refine((value) => value.kind !== 'deactivation' || value.scope === 'global');
export type DispositionInput = z.infer<typeof DispositionInput>;
export type DispositionEffect = {
  id: string;
  actionId: string;
  type: string;
  target: string;
  board: string | null;
  penaltyId: string | null;
  reason: string;
  until: string | null;
  status: string;
  currentVersion?: string | null;
};
export const ReportReason = z.enum([
  'spam',
  'harassment',
  'hate',
  'privacy',
  'fraud',
  'copyright',
  'inaccurate',
  'other',
]);
export { reportReasons } from './report-reasons.js';
export const ReportSchema = z.strictObject({
  target: z.string().min(1).max(150),
  category: ReportReasonId,
  detail: z.string().trim().max(1000).default(''),
});
export const AppealSchema = z.strictObject({
  actionId: z.uuid(),
  reason: z.string().trim().min(2).max(1000),
});
export type GovernanceRecord = {
  id: string;
  title: string;
  reason: string;
  createdAt: string;
  status: string;
  actionId?: string;
  appeal?: { status: string; resolution: string };
  until?: string | null;
  effects?: DispositionEffect[];
};
export type GovernanceStatus = {
  reports: GovernanceRecord[];
  actions: GovernanceRecord[];
  suspended: boolean;
};
export const AdminActionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    id: z.uuid(),
    action: z.literal('disposition'),
    target: z.string().min(1).max(64),
    disposition: DispositionInput,
    reason,
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('post.review'),
    target: z.string().min(1).max(100),
    outcome: z.enum(['approved', 'rejected']),
    reason,
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('penalty'),
    target: z.string().min(1).max(64),
    capability: z.enum(['warning', 'publish', 'messages', 'wiki', 'profile', 'suspension']),
    hours: z.number().int().min(0).max(8760),
    reason,
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('penalty.revoke'),
    target: z.uuid(),
    expectedVersion: z.string().optional(),
    reason,
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('appeal.review'),
    target: z.uuid(),
    outcome: z.enum(['upheld', 'reversed']),
    reason,
    decisions: z
      .array(
        z.strictObject({
          effectId: z.string().min(1).max(100),
          outcome: z.enum(['upheld', 'reversed']),
          releaseCurrentVersion: z.string().optional(),
        }),
      )
      .min(1)
      .max(20)
      .refine((items) => new Set(items.map((item) => item.effectId)).size === items.length)
      .optional(),
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('case.escalate'),
    target: z.string().min(1).max(150),
    reason: optionalReason,
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('content.label'),
    target: z.string().min(1).max(150),
    label: z.enum(['notice', 'revision', 'spam']),
    value: z.boolean(),
    reason,
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('wiki.manage'),
    target: z.string().min(1).max(64),
    protection: z.enum(['open', 'trusted', 'staff']).optional(),
    hours: z.number().int().min(0).max(8760).default(0),
    quality: z.enum(['none', 'sources', 'outdated', 'disputed']).optional(),
    title: z.string().trim().min(1).max(80).optional(),
    revision: z.number().int().min(1).optional(),
    hidden: z.boolean().optional(),
    patrolled: z.boolean().optional(),
    reason,
  }),
  z
    .strictObject({
      id: z.uuid(),
      action: z.literal('case.resolve'),
      target: z.string().min(1).max(150),
      reportIds: z.array(z.string().min(1).max(150)).min(1).max(500),
      outcome: z.enum(['handled', 'dismissed']),
      hidden: z.boolean().default(false),
      hours: z.union([z.literal(0), z.literal(1), z.literal(24), z.literal(168)]).default(0),
      accountPenalty: z
        .object({
          capability: z.enum(['publish', 'suspension']),
          hours: z.number().int().min(0).max(8760),
        })
        .optional(),
      authorDisposition: DispositionInput.optional(),
      reason: optionalReason,
    })
    .refine(
      (value) =>
        !(value.hidden || value.hours || value.accountPenalty || value.authorDisposition) ||
        value.reason.length >= 2,
    ),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('member.role'),
    target: z.string().min(1).max(64),
    role: z.enum(['owner', 'moderator', 'remove']),
    reason,
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('note'),
    target: z.string().min(1).max(64),
    reason,
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('wiki.protect'),
    target: z.string().min(1).max(64),
    protected: z.boolean(),
    reason,
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('post.settings'),
    target: z.string().regex(/^post:[a-zA-Z0-9_-]+$/),
    pinned: z.boolean().optional(),
    locked: z.boolean().optional(),
    archived: z.boolean().optional(),
    community: DemoBoard.optional(),
    reason,
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('visibility'),
    target: z
      .string()
      .max(150)
      .regex(/^(post|reply):[a-zA-Z0-9_:-]+$/),
    hidden: z.boolean(),
    reason,
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('report'),
    target: z.string().min(1).max(150),
    outcome: z.enum(['handled', 'dismissed']),
    reason,
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('restriction'),
    target: z.string().min(1).max(64),
    hours: z.union([z.literal(0), z.literal(1), z.literal(24), z.literal(168)]),
    reason,
  }),
  z.strictObject({
    id: z.uuid(),
    action: z.literal('wiki.restore'),
    target: z.string().min(1).max(64),
    revision: z.number().int().min(1),
    baseRevision: z.number().int().min(1),
    reason,
  }),
]);
export type AdminAction = z.infer<typeof AdminActionSchema>;
export type AdminSection =
  'reports' | 'content' | 'users' | 'wiki' | 'history' | 'team' | 'appeals' | 'reviews' | 'trash';
export * from './moderation-permissions.js';
import { moderationPermissions, type ModerationPermission } from './moderation-permissions.js';
export const ModerationGroupInput = z.strictObject({
  id: z.uuid().optional(),
  name: z.string().trim().min(2).max(80),
  boards: z.array(DemoBoard).max(200),
  permissions: z.array(z.enum(moderationPermissions)).max(30),
  members: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
  expectedMembers: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
});
export type ModerationGroup = Omit<
  z.infer<typeof ModerationGroupInput>,
  'expectedMembers' | 'members'
> & {
  id: string;
  members: string[];
  memberDetails?: {
    id: string;
    handle: string;
    nickname: string;
    boards?: z.infer<typeof DemoBoard>[];
  }[];
  owners?: string[];
  invitations?: { id: string; userId: string; nickname: string; handle: string; board: string }[];
  builtin?: boolean;
};
export const ModerationMembershipInput = z.strictObject({
  groupId: z.union([z.uuid(), z.literal('admin')]),
  userId: z.uuid(),
  member: z.boolean(),
});
export const GroupMembersInput = z.strictObject({
  groupId: z.union([z.uuid(), z.literal('admin')]),
  userIds: z.array(z.uuid()).min(1).max(200),
  member: z.boolean(),
  boards: z.array(DemoBoard).max(200).optional(),
});
export const ModeratorMemberBoardsInput = z.strictObject({
  userIds: z.array(z.uuid()).min(1).max(200),
  boards: z.array(DemoBoard).max(200),
});
export const GroupDeleteInput = z.strictObject({ id: z.uuid() });
export const OwnershipTransferInput = z.strictObject({ userId: z.uuid() });
export const AdminQuerySchema = z.object({
  section: z
    .enum(['reports', 'content', 'users', 'wiki', 'history', 'team', 'appeals', 'reviews', 'trash'])
    .default('reports'),
  board: DemoBoard.optional(),
  q: z.string().max(100).default(''),
  status: z
    .enum([
      'all',
      'pending',
      'handled',
      'dismissed',
      'hidden',
      'visible',
      'restricted',
      'escalated',
      'active',
      'new',
      'staff',
      'suspended',
      'muted',
      'partial',
      'upheld',
      'reversed',
      'approved',
      'rejected',
    ])
    .default('all'),
  kind: z.enum(['all', 'post', 'reply', 'message', 'user', 'wiki']).default('all'),
  record: z.string().min(1).max(150).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export type AdminQuery = z.infer<typeof AdminQuerySchema>;
export type AdminItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  author: string;
  authorId: string;
  status: string;
  createdAt: string;
  target: string;
  href: string;
  reason?: string;
  resolution?: string;
  reporter?: string;
  until?: string | null;
  wiki?: DemoWiki;
  images?: string[];
  boards?: string[];
  reportIds?: string[];
  publishedAt?: string;
  contentHidden?: boolean;
  reporterId?: string;
  categoryLabel?: string;
  reportDetail?: string;
  reports?: {
    id: string;
    reason: string;
    reporter: string;
    reporterId?: string;
    categoryLabel?: string;
    detail?: string;
    createdAt: string;
  }[];
  role?: string;
  handle?: string;
  lastSeenAt?: string | null;
  staff?: boolean;
  suspended?: boolean;
  muted?: boolean;
  manageable?: boolean;
  protected?: boolean;
  pinned?: boolean;
  locked?: boolean;
  archived?: boolean;
  labels?: Record<string, string>;
  penalties?: {
    id: string;
    capability: string;
    reason: string;
    until: string | null;
    board?: string | null;
  }[];
  restorations?: { id: string; author: string; createdAt: string; reason: string }[];
  originalAction?: {
    action: string;
    reason: string;
    actor: string;
    target: string;
    createdAt: string;
  };
  effects?: DispositionEffect[];
};
export type ModerationAccess = {
  admin: boolean;
  owner?: boolean;
  boards: { board: string; role: string; permissions?: ModerationPermission[] }[];
};
export type AdminOverview = {
  pending: number;
  posts: number;
  replies: number;
  users: number;
  restricted: number;
  wiki: number;
};
export type AdminList = { items: AdminItem[]; total: number; page: number; pageSize: number };
