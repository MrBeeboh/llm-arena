import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const API_PORT = parseInt(process.env.PORT || '5175', 10);
const VITE_PORT = parseInt(process.env.VITE_DEV_PORT || '5173', 10);

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: VITE_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true
      }
    }
  }
});
