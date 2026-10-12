import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Ensure relative paths for static hosting on GitHub Pages
  build: {
    outDir: 'docs' // Build directly into /docs for GitHub Pages hosting
  },
  server: {
    port: 3000,
    host: true
  },
  optimizeDeps: {
    exclude: ['dwgdxf']
  }
});
