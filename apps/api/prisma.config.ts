import { defineConfig } from 'prisma/config';
import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const provider = process.env.DATABASE_PROVIDER ||
  (process.env.DATABASE_URL?.startsWith('mysql:') ? 'mysql' : 'postgresql');
if (!['mysql', 'postgresql'].includes(provider)) throw new Error('DATABASE_PROVIDER 必须为 mysql 或 postgresql');
export default defineConfig({
  schema: provider === 'mysql' ? 'prisma/mysql/schema.prisma' : 'prisma/schema.prisma',
  migrations: { path: provider === 'mysql' ? 'prisma/mysql/migrations' : 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL },
});
