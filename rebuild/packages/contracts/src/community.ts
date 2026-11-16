import { z } from 'zod';

export const DemoId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/)
  .refine((value) => !Object.hasOwn(Object.prototype, value), 'INVALID_ID');
export const DefaultBoard = z.enum([
  'daily',
  'questions',
  'market',
  'treehole',
  'buddies',
  'resources',
]);
export const DemoBoard = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/);
const storedImage = z.string().regex(/^\/api\/backend\/demo\/assets\/[a-f0-9]{64}$/);
const short = z.string().max(1000);
export const DemoImage = z
  .string()
  .max(1_400_000)
  .refine((value) => {
    const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) return false;
    const bytes = Buffer.from(match[2]!, 'base64');
    if (bytes.length > 1_000_000) return false;
    return match[1] === 'png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === 'jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : match[1] === 'gif'
          ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
          : bytes.subarray(0, 4).toString() === 'RIFF' &&
            bytes.subarray(8, 12).toString() === 'WEBP';
  }, 'INVALID_IMAGE');
const image = z.union([DemoImage, storedImage]);
export const PostDraft = z.object({
  id: DemoId,
  community: DemoBoard,
  title: z.string().trim().min(1).max(200),
  body: z.string().max(2000),
  html: z.string().max(30000).optional(),
  images: z.array(image).max(4).optional(),
  tags: z.array(z.string().min(1).max(40)).max(3).optional(),
  price: short.optional(),
  meeting: short.optional(),
  meetingAt: z.number().finite().optional(),
  project: z
    .object({ work: short.optional(), access: short.optional(), feedback: short.optional() })
    .optional(),
});
export const ReplyDraft = z.object({
  id: DemoId,
  body: z.string().max(500),
  image: image.optional(),
  parentId: DemoId.optional(),
  replyTo: DemoId.optional(),
});
export const WikiDraft = z.object({
  id: DemoId,
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(180),
  communities: z.array(DemoBoard).max(200),
  sections: z
    .array(
      z.object({
        id: DemoId.optional(),
        h: z.string().min(1).max(80),
        p: z.string().min(1).max(10000),
      }),
    )
    .min(1)
    .max(30),
  quick: z
    .array(z.tuple([short, short]))
    .max(30)
    .default([]),
  table: z
    .object({ heads: z.array(short).max(10), rows: z.array(z.array(short).max(10)).max(100) })
    .nullable()
    .optional(),
  reference: short.default(''),
});
export const Profile = z.object({
  name: z.string().trim().min(1).max(32),
  bio: z.string().max(60).default(''),
  avatar: z.union([z.literal(''), image]).default(''),
  school: short.default(''),
  campus: short.default(''),
  dept: short.default(''),
  year: short.default(''),
  tags: z.array(z.string().max(40)).max(6).default([]),
});
const state = z.object({
  bookmarks: z.array(DemoId).max(1000).optional(),
  follows: z.array(DemoId).max(1000).optional(),
  followedBoards: z.array(DemoBoard).max(200).optional(),
  tagFollows: z.array(z.string().max(40)).max(100).optional(),
  readNotifications: z.array(z.string().max(150)).max(1000).optional(),
  notifPrefs: z
    .object({ reply: z.boolean(), like: z.boolean(), follow: z.boolean(), system: z.boolean() })
    .optional(),
  privacyPrefs: z.object({ profilePublic: z.boolean(), marksPublic: z.boolean() }).optional(),
});
export const Operation = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('post.report'),
    postId: DemoId,
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({ type: z.literal('post.create'), post: PostDraft }),
  z.object({ type: z.literal('reply.create'), postId: DemoId, reply: ReplyDraft }),
  z.object({
    type: z.literal('post.edit'),
    postId: DemoId,
    title: z.string().trim().min(1).max(200),
    body: z.string().max(2000),
    html: z.string().max(30000).optional(),
  }),
  z.object({
    type: z.literal('reply.edit'),
    postId: DemoId,
    replyId: DemoId,
    body: z.string().trim().min(1).max(500),
  }),
  z.object({ type: z.literal('post.vote'), postId: DemoId, value: z.boolean() }),
  z.object({ type: z.literal('reply.vote'), postId: DemoId, replyId: DemoId, value: z.boolean() }),
  z.object({
    type: z.literal('post.update'),
    postId: DemoId,
    body: z.string().trim().min(1).max(2000),
  }),
  z.object({ type: z.literal('post.sold'), postId: DemoId, value: z.boolean() }),
  z.object({ type: z.literal('post.accept'), postId: DemoId, replyId: DemoId.nullable() }),
  z.object({ type: z.literal('post.wiki'), postId: DemoId, wikiId: DemoId.nullable() }),
  z.object({
    type: z.literal('wiki.save'),
    wiki: WikiDraft,
    baseRevision: z.number().int().min(0),
    reason: z.string().min(1).max(160),
    applied: z.array(DemoId).max(100).default([]),
  }),
  z.object({
    type: z.literal('wiki.note'),
    wikiId: DemoId,
    text: z.string().trim().min(1).max(4000),
  }),
  z.object({
    type: z.literal('wiki.suggest'),
    id: DemoId.optional(),
    wikiId: DemoId,
    index: z.number().int().min(0),
    text: z.string().trim().min(1).max(4000),
    reference: short,
  }),
  z.object({ type: z.literal('profile.save'), profile: Profile }),
  z.object({ type: z.literal('state.save'), state }),
  z.object({
    type: z.literal('message.send'),
    id: DemoId,
    peer: DemoId,
    text: z.string().max(500),
    postId: DemoId.optional(),
  }),
  z.object({ type: z.literal('message.read'), peer: DemoId }),
]);
export const Batch = z.strictObject({
  id: z.string().uuid(),
  operations: z.array(Operation).min(1).max(50),
});
export type DemoOperation = z.infer<typeof Operation>;
export type DemoBatch = z.infer<typeof Batch>;
export type DemoPost = z.infer<typeof PostDraft> & {
  replyCount?: number;
  activityAt?: number;
  feedScore?: number;
  summary?: boolean;
  archived?: boolean;
  moderationLabels?: Record<string, string>;
  pinned?: boolean;
  locked?: boolean;
  author: string;
  authorId: string;
  createdAt: number;
  likes: number;
  sold?: boolean;
  best?: string;
  wikiRef?: { id: string; answerId?: string };
  updates?: { body: string; createdAt: number }[];
};
export type DemoReply = z.infer<typeof ReplyDraft> & {
  moderationLabels?: Record<string, string>;
  author: string;
  authorId: string;
  createdAt: number;
  likes: number;
  replyToName?: string;
  replyBody?: string;
};
export type DemoWiki = z.infer<typeof WikiDraft> & {
  protection?: 'open' | 'trusted' | 'staff';
  protectionUntil?: string | null;
  quality?: string;
  previousTitles?: string[];
  hiddenRevisions?: number[];
  patrolledRevisions?: number[];
  protected?: boolean;
  slug: string;
  wikiFormat: number;
  example: boolean;
  kind: string;
  scope: string;
  revisions: number;
  editor: string;
  editorId?: string;
  updatedAt: string;
  history: Record<string, unknown>[];
  notes: Record<string, unknown>[];
  suggestions: Record<string, unknown>[];
};
export type DemoContent = {
  posts: DemoPost[];
  comments: Record<string, DemoReply[]>;
  wiki: DemoWiki[];
  votes: Record<string, string[]>;
  commentVotes: Record<string, string[]>;
};
export type DemoState = {
  bookmarks?: string[];
  follows?: string[];
  followedBoards?: string[];
  tagFollows?: string[];
  readNotifications?: string[];
  notifPrefs?: { reply: boolean; like: boolean; follow: boolean; system: boolean };
  privacyPrefs?: { profilePublic: boolean; marksPublic: boolean };
  profile?: z.infer<typeof Profile>;
};
export const emptyContent = (): DemoContent => ({
  posts: [],
  comments: {},
  wiki: [],
  votes: {},
  commentVotes: {},
});
