import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Consumes the PUBLISHED `onda-engine` umbrella (the wasm cores are bundled into
// it), so this app builds on Vercel with no Rust toolchain and no committed
// wasm. Dedupe React so hooks see a single copy across the umbrella and the app.
// (Engine source lives in this monorepo, but each wasm `pkg/` output is
// gitignored and only minted in CI — so deployed apps consume the published
// package; see apps/preview/README.md.)
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-reconciler'],
  },
})
