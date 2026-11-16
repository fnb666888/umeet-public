import { z } from 'zod';

export const AccountProfileInput = z.strictObject({
  handle: z
    .string()
    .transform((value) => value.normalize('NFKC').trim().toLowerCase())
    .pipe(z.string().regex(/^[a-z0-9_][a-z0-9_-]{2,31}$/)),
  nickname: z.string().trim().min(1).max(32).optional(),
});
export const AccountOverviewSchema = z.object({
  userId: z.string(),
  handle: z.string().nullable(),
  nickname: z.string(),
  usernameChangesRemaining: z.number().int().min(0).max(1),
  needsOnboarding: z.boolean(),
  requiresReauthentication: z.boolean(),
  hasPassword: z.boolean(),
  passwordUsername: z.string().nullable(),
  securityEvents: z.array(z.object({ id: z.string(), kind: z.string(), createdAt: z.string() })),
  identities: z.array(
    z.object({
      provider: z.string(),
      label: z.string(),
      key: z.string(),
      email: z.string().optional(),
    }),
  ),
  sessions: z.array(
    z.object({
      id: z.string(),
      device: z.string(),
      current: z.boolean(),
      createdAt: z.string(),
      lastSeenAt: z.string(),
      expiresAt: z.string(),
    }),
  ),
});
export type AccountOverview = z.infer<typeof AccountOverviewSchema>;
