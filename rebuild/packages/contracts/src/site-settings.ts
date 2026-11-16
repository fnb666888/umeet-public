import { z } from 'zod';
import { DemoBoard } from './community.js';

export const ReportReasonId = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9-]*$/);
export const InviteCode = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{32}$/);
export const registrationSettings = z
  .strictObject({
    mode: z.enum(['open', 'invite', 'campus']),
    domains: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .max(253)
          .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
      )
      .max(20),
  })
  .refine(
    (value) => value.mode !== 'campus' || value.domains.length > 0,
    '校园邮箱注册至少需要一个邮箱域名',
  );
const boardList = z
  .array(DemoBoard)
  .max(200)
  .refine((values) => new Set(values).size === values.length);
const link = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    if (!value) return true;
    if (!/^https:\/\//i.test(value)) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, '请填写有效的 HTTPS 地址');

export const BoardSettingsSchema = z.strictObject({
  description: z.string().trim().min(1).max(160),
  rules: z.array(z.string().trim().min(1).max(120)).max(6),
  prompt: z.string().trim().max(240),
  posting: z
    .strictObject({
      readonly: z.boolean(),
      firstPostReview: z.boolean(),
      cooldownSeconds: z.number().int().min(0).max(3600),
    })
    .default({ readonly: false, firstPostReview: false, cooldownSeconds: 0 }),
});

export const SiteSettingsSchema = z.strictObject({
  site: z.strictObject({
    title: z.string().trim().min(1).max(40),
    description: z.string().trim().max(240),
    logo: link,
    feedback: link,
  }),
  boards: z
    .object({
      daily: BoardSettingsSchema,
      questions: BoardSettingsSchema,
      market: BoardSettingsSchema,
      treehole: BoardSettingsSchema,
      buddies: BoardSettingsSchema,
      resources: BoardSettingsSchema,
    })
    .catchall(BoardSettingsSchema),
  announcements: z
    .array(
      z
        .strictObject({
          id: z.uuid(),
          title: z.string().trim().min(1).max(80),
          body: z.string().trim().min(1).max(500),
          boards: boardList,
          enabled: z.boolean(),
          startsAt: z.iso.datetime().nullable(),
          endsAt: z.iso.datetime().nullable(),
        })
        .refine(
          (value) =>
            !value.startsAt ||
            !value.endsAt ||
            Date.parse(value.startsAt) < Date.parse(value.endsAt),
          '结束时间必须晚于开始时间',
        ),
    )
    .max(8)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length),
  reportReasons: z
    .array(
      z.strictObject({
        id: ReportReasonId,
        label: z.string().trim().min(1).max(40),
        enabled: z.boolean(),
        boards: boardList,
      }),
    )
    .max(30)
    .refine(
      (reasons) =>
        new Set(reasons.map((reason) => reason.id)).size === reasons.length &&
        reasons.some((reason) => reason.id === 'other' && reason.enabled && !reason.boards.length),
      '必须保留一项全站启用的「其他」举报理由',
    ),
  registration: registrationSettings.default({ mode: 'open', domains: [] }),
  notifications: z.strictObject({ announcements: z.boolean() }).default({ announcements: false }),
});

export const UpdateSiteSettingsSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  settings: SiteSettingsSchema,
});
export type SiteSettings = z.infer<typeof SiteSettingsSchema>;
export type SiteSettingsSnapshot = { revision: number; settings: SiteSettings };
export type PublicSiteSettings = Omit<SiteSettings, 'registration'> & {
  registration: Pick<SiteSettings['registration'], 'mode'>;
  refreshAfterMs: number | null;
};
