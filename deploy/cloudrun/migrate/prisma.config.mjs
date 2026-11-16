import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: '/app/apps/api/prisma/mysql/schema.prisma',
  migrations: { path: '/app/apps/api/prisma/mysql/migrations' },
  datasource: { url: process.env.DATABASE_URL },
});
