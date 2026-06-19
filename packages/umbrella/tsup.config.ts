import type { Plugin } from 'esbuild'
import { defineConfig } from 'tsup'

/**
 * Rewrite internal `@onda-engine/*` imports to the umbrella's own `onda-engine/*`
 * subpaths and mark them external. This keeps each sub-package a SINGLE shared
 * module at runtime (critical for `@onda-engine/react` — its react-reconciler
 * carries module-level singleton state that must not be duplicated across the
 * components/player/render/cinema bundles), and routes cross-package imports
 * through this package's own `exports` map instead of inlining copies.
 */
const rewriteInternalScope: Plugin = {
  name: 'rewrite-onda-engine-scope',
  setup(build) {
    build.onResolve({ filter: /^@onda-engine\// }, (args) => ({
      path: args.path.replace(/^@onda-engine\//, 'onda-engine/'),
      external: true,
    }))
  },
}

export default defineConfig({
  // Each entry is compiled straight from its sibling package's source; the
  // plugin above rewrites the internal cross-imports to `onda-engine/*` subpaths.
  entry: {
    index: 'src/index.ts',
    react: '../react/src/index.ts',
    components: '../components/src/index.ts',
    'components-manifest': '../components/src/manifest.ts',
    player: '../player/src/index.ts',
    render: '../render/src/index.ts',
    cinema: '../cinema/src/index.tsx',
  },
  format: ['esm'],
  outDir: 'dist',
  platform: 'neutral',
  target: 'es2022',
  splitting: true,
  treeshake: true,
  sourcemap: true,
  clean: true,
  // Inline the @onda-engine type graph so the published .d.ts files carry no
  // `@onda-engine/*` references (resolved from each sub-package's built dist).
  dts: { resolve: [/^@onda-engine\//] },
  esbuildPlugins: [rewriteInternalScope],
  // Real third-party deps stay external (declared in package.json deps/peers).
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-reconciler', 'flubber', 'zod'],
  // Copy the prebuilt wasm artifacts in beside the JS so each `.wasm` ships
  // adjacent to its wasm-bindgen glue (the browser auto-locate contract).
  onSuccess: 'node scripts/copy-wasm.mjs',
})
