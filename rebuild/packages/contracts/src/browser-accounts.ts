import { z } from 'zod';
export const BrowserAccountSchema = z.strictObject({
  id: z.string(),
  userId: z.string(),
  username: z.string(),
  nickname: z.string(),
  roleLabel: z.string(),
  status: z.enum(['ready', 'expired', 'blocked']),
});
export const BrowserAccountStateSchema = z.strictObject({
  deviceId: z.string(),
  version: z.number().int().nonnegative(),
  currentUserId: z.string().nullable(),
  accounts: z.array(BrowserAccountSchema).max(5),
});
export type BrowserAccountState = z.infer<typeof BrowserAccountStateSchema>;
export type BrowserAccount = z.infer<typeof BrowserAccountSchema>;
