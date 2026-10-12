import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Ensure relative paths for static hosting on GitHub Pages
  server: {
    port: 3000,
    host: true
  },
  optimizeDeps: {
    exclude: ['dwgdxf']
  }
});
