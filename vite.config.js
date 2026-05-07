import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Set base to '/Uncapped/' for GitHub Pages deployment.
// In local dev it's '/' unless GITHUB_PAGES=true is set.
const base = process.env.GITHUB_PAGES ? '/Uncapped/' : '/';

export default defineConfig({
  base,
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      // simple-peer uses Node globals; polyfill them for the browser bundle.
      external: [],
    },
  },
  define: {
    // simple-peer references process.env in its UMD bundle check.
    'process.env': '{}',
    global: 'globalThis',
  },
});
