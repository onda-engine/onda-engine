import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// A generic live composition viewer. Consumes the PUBLISHED `onda-engine`
// umbrella (the wasm cores are bundled into it), so this app builds on Vercel
// with no Rust toolchain and no committed wasm — and dev matches prod. (The
// engine source lives in this monorepo, but each wasm `pkg/` output is
// gitignored and only minted in CI; apps that need live engine-source
// hot-reload — e.g. apps/playground — alias the workspace src instead.)
// `base: './'` makes the built app load its assets — and fetch its
// `composition.json` — relative to wherever it's served from (any path/subdir),
// which is how the ONDA Studio MCP drops a payload next to index.html and serves
// it from an arbitrary directory.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-reconciler'],
  },
})
