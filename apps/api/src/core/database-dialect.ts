import { Prisma } from '@prisma/client';

export function databaseProvider(): 'mysql' | 'postgresql' {
  const provider = process.env.DATABASE_PROVIDER ||
    (process.env.DATABASE_URL?.startsWith('mysql:') ? 'mysql' : 'postgresql');
  if (provider !== 'mysql' && provider !== 'postgresql')
    throw new Error('DATABASE_PROVIDER 必须为 mysql 或 postgresql');
  return provider;
}

// Only static template text is transformed. Interpolated values remain bound parameters.
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Prisma.Sql {
  const text = databaseProvider() === 'mysql'
    ? strings.map((part) => part.replace(/"([A-Za-z][A-Za-z0-9_]*)"/g, '`$1`')
        .replace(/FOR SHARE\b/g, 'LOCK IN SHARE MODE').replace(/FOR UPDATE SKIP LOCKED\b/g, 'FOR UPDATE'))
    : strings;
  return Prisma.sql(text, ...values);
}

export function containsText(value: string) {
  return databaseProvider() === 'mysql'
    ? { contains: value }
    : { contains: value, mode: 'insensitive' as const };
}

export function emailDomains(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((domain): domain is string => typeof domain === 'string'))
    throw new Error('学校邮箱域名配置必须为字符串数组');
  return value;
}
