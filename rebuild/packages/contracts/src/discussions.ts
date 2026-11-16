import { z } from 'zod';

export const DiscussionId = z.uuid();
export const CommunitySlug = z.string().regex(/^[a-z0-9-]{1,80}$/);
export const PostInputSchema = z.strictObject({
  id: DiscussionId,
  community: CommunitySlug,
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(10000),
});
export const CommentInputSchema = z.strictObject({
  id: DiscussionId,
  parentId: DiscussionId.nullable(),
  body: z.string().trim().min(1).max(2000),
});
export const DiscussionReason = z.string().trim().min(1).max(500);
export const VoteSchema = z.strictObject({
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});
export type PostInput = z.infer<typeof PostInputSchema>;
export type CommentInput = z.infer<typeof CommentInputSchema>;
export type Vote = z.infer<typeof VoteSchema>['value'];
export type DiscussionPost = {
  id: string;
  communitySlug: string;
  communityName: string;
  author: string;
  title: string;
  body: string;
  publishedAt: string;
  score: number;
  replyCount: number;
};
export type DiscussionComment = {
  id: string;
  parentId: string | null;
  author: string;
  body: string;
  createdAt: string;
};
export type DiscussionDetail = {
  post: DiscussionPost;
  comments: DiscussionComment[];
  vote: Vote;
  canModerate: boolean;
};
export type DiscussionReview = {
  posts: {
    id: string;
    communitySlug: string;
    title: string;
    body: string;
    state: string;
    reports: string[];
  }[];
};
