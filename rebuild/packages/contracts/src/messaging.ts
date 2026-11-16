import { z } from 'zod';
import { DemoId } from './community.js';
export const SendMessage = z
  .object({ id: DemoId, text: z.string().trim().max(2000), postId: DemoId.optional() })
  .refine((v) => v.text.length > 0 || v.postId, 'EMPTY_MESSAGE');
export const ConversationAction = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['accept', 'ignore', 'hide', 'restore']) }),
  z.object({ action: z.enum(['mute', 'block']), value: z.boolean() }),
  z.object({ action: z.literal('read'), messageId: DemoId }),
  z.object({
    action: z.literal('report'),
    id: DemoId,
    messageId: DemoId,
    reason: z.string().trim().min(1).max(500),
  }),
]);
export type Message = {
  id: string;
  text: string;
  postId: string | null;
  createdAt: string;
  incoming: boolean;
};
export type Conversation = {
  peer: string;
  name: string;
  avatar: string;
  deleted: boolean;
  status: 'new' | 'pending' | 'accepted' | 'ignored';
  incomingRequest: boolean;
  blocked: boolean;
  unavailable: boolean;
  muted: boolean;
  hidden: boolean;
  unread: number;
  lastMessage: Message | null;
  updatedAt: string | null;
};
export type InboxSummary = {
  conversations: Conversation[];
  next: string | null;
  unread: number;
  requests: number;
  allowRequests: boolean;
};
export type MessagePage = { conversation: Conversation; messages: Message[]; hasMore: boolean };
