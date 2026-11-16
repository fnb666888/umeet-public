import { z } from 'zod';

export const interestBoards = [
  { slug: 'ai', name: 'AI', description: '模型、应用与人工智能实践' },
  { slug: 'technology', name: '科技', description: '技术进展与值得检验的新想法' },
  { slug: 'opensource', name: '开源', description: '项目、版本、协作与开放知识' },
  { slug: 'web3', name: 'Web3 技术', description: '开放网络、协议与可验证记录' },
] as const;
export const contentBoards = [
  { slug: 'news', name: '资讯', description: '来自可信来源的资讯更新与社区讨论' },
  { slug: 'forecasts', name: '预测', description: '每天一道预测，查看证据、讨论与结果复盘' },
] as const;
export function isContentBoard(slug: string) {
  return contentBoards.some((board) => board.slug === slug);
}
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const InterestPreferencesInput = z.strictObject({
  onboarding: z.enum(['completed', 'skipped']),
  boards: z.array(id).max(100),
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
});
export type InterestPreferences = z.infer<typeof InterestPreferencesInput> & {
  dismissed: string[];
};
export const PollInput = z
  .strictObject({
    postId: id,
    question: z.string().trim().min(2).max(200),
    options: z.array(z.string().trim().min(1).max(100)).min(2).max(8),
    endsAt: z.iso.datetime(),
  })
  .refine((v) => new Set(v.options).size === v.options.length, 'DUPLICATE_OPTIONS');
export const PollVoteInput = z.strictObject({
  option: z.number().int().min(0).max(7),
  version: z.number().int().min(1),
});
export type PollView = {
  id: string;
  postId: string;
  question: string;
  options: { text: string; count: number }[];
  endsAt: string;
  state: string;
  total: number;
  myVote: number | null;
  canEdit: boolean;
  version: number;
};
export const ArtifactKind = z.enum(['news', 'forecast']);
export type ArtifactKind = z.infer<typeof ArtifactKind>;
export const ArtifactCommentInput = z.strictObject({
  id: z.uuid(),
  body: z.string().trim().min(1).max(4000),
});
export const ArtifactActionInput = z.strictObject({
  kind: z.enum(['save', 'follow']),
  active: z.boolean(),
});
export const ArtifactReportInput = z.strictObject({
  reason: z.string().trim().min(2).max(1000),
  commentId: id.optional(),
});
export type ArtifactComment = {
  id: string;
  author: string;
  authorId: string;
  body: string;
  createdAt: string;
  hidden: boolean;
};
export type Evidence = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  fetchedAt: string;
};
export type NewsCard = {
  id: string;
  title: string;
  url: string;
  summary: string;
  board: string;
  source: string;
  publishedAt: string;
  language: string;
};
export type ForecastCard = {
  id: string;
  title: string;
  field: string;
  probability: number;
  reasoning: string;
  counterEvidence: string;
  evidence: Evidence[];
  informationAt: string;
  deadline: string;
  rules: string;
  createdAt: string;
  state: string;
  outcome: number | null;
  resolution: string;
  resultEvidence: Evidence[];
  brier: number | null;
};
export type ArtifactDetail = {
  item: NewsCard | ForecastCard;
  comments: ArtifactComment[];
  saved: boolean;
  followed: boolean;
};
export const ForecastFields = ['technology', 'politics', 'economics', 'sports'] as const;
export const SourceInput = z.strictObject({
  id,
  name: z.string().trim().min(1).max(100),
  board: id,
  kind: z.enum(['github', 'jsonfeed', 'rss']),
  url: z.url().max(1000),
  enabled: z.boolean(),
  approved: z.boolean(),
  termsUrl: z.url().max(1000),
});
export const TemplateInput = z.strictObject({
  id,
  name: z.string().trim().min(2).max(100),
  field: z.enum(ForecastFields),
  board: id,
  sourceId: id,
  enabled: z.boolean(),
  target: z.string().trim().min(1).max(100),
  daysAhead: z.number().int().min(1).max(365),
});
export const ForecastOutput = z.strictObject({
  probability: z.number().min(0).max(1),
  reasoning: z.string().trim().min(20).max(5000),
  counterEvidence: z.string().trim().min(5).max(3000),
  evidenceIds: z.array(id).min(1).max(20),
});
export const ResolutionInput = z
  .strictObject({
    state: z.enum(['resolved', 'void']),
    outcome: z.union([z.literal(0), z.literal(1)]).nullable(),
    reason: z.string().trim().min(5).max(3000),
    evidence: z
      .array(z.strictObject({ title: z.string().min(1).max(200), url: z.url().max(1000) }))
      .max(20),
  })
  .refine((v) =>
    v.state === 'resolved' ? v.outcome !== null && v.evidence.length > 0 : v.outcome === null,
  );
export const ModerationInput = z.strictObject({
  targetType: z.enum(['news', 'forecast', 'comment']),
  targetId: id,
  hidden: z.boolean(),
  reason: z.string().trim().min(2).max(1000),
});
