import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Resolve the workspace packages to their TypeScript source so the dev server
// has hot reload without a separate build step, and dedupe React so hooks see a
// single copy across @onda/react, @onda/player, and the app.
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-reconciler'],
    alias: {
      '@onda/react': fileURLToPath(new URL('../../packages/react/src/index.ts', import.meta.url)),
      '@onda/player': fileURLToPath(new URL('../../packages/player/src/index.ts', import.meta.url)),
    },
  },
})
