import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// A generic live composition viewer. Mirrors apps/playground's config (same
// wasm + Player setup, the same workspace src aliases + React dedupe) so the
// dev server hot-reloads without a separate build step. The one addition is
// `base: './'`, so the built app loads its assets — and fetches its
// `composition.json` — relative to wherever it's served from (any path/subdir),
// which is how the ONDA Studio MCP drops a payload next to index.html and serves
// it from an arbitrary directory.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-reconciler'],
    alias: {
      '@onda-engine/react': fileURLToPath(new URL('../../packages/react/src/index.ts', import.meta.url)),
      '@onda-engine/player': fileURLToPath(new URL('../../packages/player/src/index.ts', import.meta.url)),
    },
  },
})
