import { z } from 'zod';
const id = z.string().trim().min(1).max(64);
const note = z.string().trim().max(2000);
export const relationKinds = ['prerequisite', 'approximation_of', 'applied_to', 'related'] as const;
export const relationLabels = {
  prerequisite: '前置知识',
  approximation_of: '近似自',
  applied_to: '应用于',
  related: '相关知识',
} as const;
export const KnowledgeRelationSchema = z.strictObject({
  type: z.enum(relationKinds),
  targetPageId: id,
  conditions: note.optional(),
  explanation: note.optional(),
  evidence: note.optional(),
});
export const KnowledgeContentSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(1000),
  markdown: z.string().min(1).max(500000),
  template: z.enum(['plain', 'handbook', 'academic']),
  relations: z.array(KnowledgeRelationSchema).max(100),
  baseRevisionId: id.nullable(),
  changeNote: note,
});
export const KnowledgeRevisionSchema = KnowledgeContentSchema.extend({
  idempotencyKey: z.string().min(8).max(100),
});
export const KnowledgeDraftSchema = z.strictObject({
  editingTaskId: id,
  pageId: id.nullable(),
  expectedVersion: z.number().int().nonnegative(),
  content: KnowledgeContentSchema.extend({
    title: z.string().max(160),
    markdown: z.string().max(500000),
  }),
});
export const KnowledgeSearchSchema = z.strictObject({
  q: z.string().trim().max(200).default(''),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const KnowledgeDirectoryChangeSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  nodes: z
    .array(
      z.strictObject({
        id,
        parentId: id.nullable(),
        title: z.string().trim().min(1).max(120),
        position: z.number().int().nonnegative(),
      }),
    )
    .max(300),
  entries: z
    .array(z.strictObject({ nodeId: id, pageId: id, position: z.number().int().nonnegative() }))
    .max(2000),
  collections: z.array(id).max(2000),
});
export const KnowledgeRouteSchema = z.strictObject({
  id: id.optional(),
  expectedVersion: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(160),
  goal: z.string().trim().min(1).max(4000),
  steps: z
    .array(
      z.strictObject({
        id: id,
        pageId: id,
        goal: note,
        intro: z.string().max(8000),
        position: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(200),
});
export const KnowledgeDisputeDecisionSchema = z.strictObject({
  action: z.enum(['pause', 'resume', 'resolve']),
  reason: z.string().trim().min(1).max(4000),
});
export type KnowledgeRelationInput = z.infer<typeof KnowledgeRelationSchema>;
export type KnowledgeContent = z.infer<typeof KnowledgeContentSchema>;
export type KnowledgeRevisionInput = z.infer<typeof KnowledgeRevisionSchema>;
export type KnowledgeDraftInput = z.infer<typeof KnowledgeDraftSchema>;
export type KnowledgeSearchInput = z.infer<typeof KnowledgeSearchSchema>;
export type KnowledgeDirectoryChange = z.infer<typeof KnowledgeDirectoryChangeSchema>;
export type KnowledgeRouteInput = z.infer<typeof KnowledgeRouteSchema>;
export type KnowledgeDisputeDecision = z.infer<typeof KnowledgeDisputeDecisionSchema>;
export type KnowledgePage = KnowledgeContent & {
  id: string;
  revisionId: string;
  authorId: string;
  authorAlias: string;
  createdAt: string;
  paused: boolean;
};
export type KnowledgeProposal = {
  id: string;
  pageId: string;
  authorId: string;
  state: 'pending' | 'returned' | 'approved';
  reason: string;
  content: KnowledgeRevisionInput;
  createdAt: string;
  version: number;
};
export type KnowledgeCapabilities = {
  accountId: string | null;
  canContribute: boolean;
  canGovernBody: boolean;
  canOrganizeCommunity: boolean;
  isSiteAdmin: boolean;
};
export type KnowledgeCommunity = {
  id: string;
  slug: string;
  name: string;
  version: number;
  nodes: KnowledgeDirectoryChange['nodes'];
  entries: (KnowledgeDirectoryChange['entries'][number] & { title: string; available: boolean })[];
  collections: { pageId: string; title: string; available: boolean }[];
};
export type KnowledgeRoute = {
  id: string;
  communityId: string;
  version: number;
  title: string;
  goal: string;
  steps: (KnowledgeRouteInput['steps'][number] & {
    title: string;
    revisionId: string | null;
    confirmedRevisionId: string | null;
    needsReview: boolean;
    available: boolean;
  })[];
};
export type KnowledgeEvent = {
  id: string;
  pageId: string | null;
  actorId: string;
  action: string;
  reason: string;
  createdAt: string;
};
export type KnowledgeDiscussion = {
  id: string;
  pageId: string;
  authorAlias: string;
  body: string;
  createdAt: string;
};
