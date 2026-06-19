// Copy the prebuilt wasm-bindgen artifacts into the umbrella's dist/ so each
// `.wasm` binary ships physically next to its JS glue. The browser path relies
// on wasm-bindgen's `new URL('..._bg.wasm', import.meta.url)` auto-locate, and
// the Node path reads the adjacent file — both require this adjacency.
//
// These are COPIED, not rebuilt: the wasm is produced by `cargo + wasm-bindgen`
// in each wasm package (needs the Rust toolchain). Run those packages' `build`
// first if `pkg/` is missing.
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const umbrella = resolve(here, '..')
const packages = resolve(umbrella, '..')

// Copy each pkg/ in VERBATIM (preserving the `/pkg/` segment all three wasm
// packages use) so a consumer's deep import — e.g. the studio's
// `onda-engine/wasm/pkg/onda_wasm_bg.wasm?url` — resolves through the umbrella's
// `./wasm/*` wildcard export with no path changes.
/** [source dir under packages/, destination dir under umbrella/dist/] */
const dirs = [
  ['wasm/pkg', 'dist/wasm/pkg'],
  ['wasm-audio/pkg', 'dist/wasm-audio/pkg'],
  ['wasm-vello/pkg', 'dist/wasm-vello/pkg'],
]

for (const [from, to] of dirs) {
  const src = resolve(packages, from)
  if (!existsSync(src)) {
    throw new Error(
      `[onda-engine] missing wasm artifacts at ${src}. Build the wasm packages first ` +
        `(cargo + wasm-bindgen), e.g. \`pnpm --filter @onda-engine/${from.split('/')[0]} build\`.`,
    )
  }
  cpSync(src, resolve(umbrella, to), { recursive: true })
}

// The vello entry is its hand-written wrapper (WebGPU shim) beside its pkg/.
cpSync(resolve(packages, 'wasm-vello/index.js'), resolve(umbrella, 'dist/wasm-vello/index.js'))
cpSync(resolve(packages, 'wasm-vello/index.d.ts'), resolve(umbrella, 'dist/wasm-vello/index.d.ts'))

console.log('[onda-engine] wasm artifacts copied into dist/ (wasm, wasm-audio, wasm-vello)')

// esbuild rewrites `import('@onda-engine/wasm')` (a real import expression) but
// CANNOT touch the string argument of `import.meta.resolve('@onda-engine/wasm')`,
// which @onda-engine/components uses for the Node-only wasm auto-locate. Repoint
// it at the umbrella's own subpath so Node consumers resolve dist/wasm/ without
// having to set ONDA_WASM_PATH. (Only patches the resolve() call, not comments.)
const dist = resolve(umbrella, 'dist')
let patched = 0
for (const file of readdirSync(dist)) {
  if (!file.endsWith('.js')) continue
  const path = resolve(dist, file)
  const before = readFileSync(path, 'utf8')
  const after = before.replace(/(import\.meta\.resolve\(\s*['"])@onda-engine\//g, '$1onda-engine/')
  if (after !== before) {
    writeFileSync(path, after)
    patched++
  }
}
if (patched > 0) console.log(`[onda-engine] repointed import.meta.resolve scope in ${patched} file(s)`)
