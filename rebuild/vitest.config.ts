import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['**/test/**/*.test.{ts,tsx}', '**/test/**/*.int.test.ts', 'probes/**/*.test.ts'],exclude:['**/node_modules/**','**/dist/**','**/.next/**'], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false } });
