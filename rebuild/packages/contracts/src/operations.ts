import { z } from 'zod';
export const LimitsSchema = z.strictObject({
  maxFileBytes: z.number().int().min(1).max(1000000000),
  dailyUploadBytes: z.number().int().min(0).max(100000000000),
  uploadsEnabled: z.boolean(),
});
export type Limits = z.infer<typeof LimitsSchema>;
export const LimitsSnapshotSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  limits: LimitsSchema,
});
export type LimitsSnapshot = z.infer<typeof LimitsSnapshotSchema>;
export const ReasonSchema = z.string().trim().min(3).max(500);
export const UpdateLimitsSchema = z.strictObject({
  baseRevision: z.number().int().nonnegative(),
  limits: LimitsSchema,
  reason: ReasonSchema,
});
export const JobStateSchema = z.enum(['pending', 'leased', 'completed', 'failed']);
export const JobListQuerySchema = z.strictObject({
  state: JobStateSchema.optional(),
  after: z.string().max(64).optional(),
});
export type JobSummary = {
  id: string;
  kind: string;
  state: z.infer<typeof JobStateSchema>;
  attempts: number;
  availableAt: string;
  leaseExpiresAt: string | null;
  lastError: string | null;
};
export type JobStats = {
  pending: number;
  leased: number;
  completed: number;
  failed: number;
  overdueLeases: number;
  oldestPendingAt: string | null;
};
