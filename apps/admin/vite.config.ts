import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), '');
  const host = env.HOST && env.HOST !== '0.0.0.0' ? env.HOST : '127.0.0.1';
  return {
    plugins: [vue()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: `http://${host}:${env.PORT || '3100'}`, changeOrigin: true } },
    },
  };
});
