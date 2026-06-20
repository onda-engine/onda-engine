# @onda-engine/preview

A generic live composition viewer for the ONDA engine. It polls a
`composition.json` next to its served `index.html` and renders it with the
Player — this is the target the ONDA Studio MCP drops a payload into.

## Why this app uses the published `onda-engine`, not the workspace packages

The wasm cores (`@onda-engine/wasm`, `-vello`, `-audio`) compile from Rust via
`cargo` + `wasm-bindgen`; their `pkg/` output is **gitignored** and only minted
in CI. Build hosts without a Rust toolchain (e.g. Vercel) therefore cannot
resolve the raw `@onda-engine/*` workspace packages — the entry points don't
exist in a fresh clone.

The published **`onda-engine`** umbrella (public npm) bundles all three wasm
cores into its `dist/` and exposes them via subpath exports (`onda-engine/wasm`,
`onda-engine/wasm-vello`, `onda-engine/cinema`, `onda-engine/player`, …). So this
app imports the umbrella and builds with no Rust and no committed binaries — and
dev matches prod.

`package.json` pins it through the npm alias
`"onda-engine": "npm:onda-engine@^0.1.1"` so pnpm always resolves the **registry**
tarball, never the local workspace `onda-engine` package (whose `dist/` is
likewise gitignored and would fail the same way).

## Bumping the engine

The umbrella publishes to npm on merge to `main` (Release Please). To pick up a
newer engine here: bump the range in `package.json`, run `pnpm install` to update
the lockfile, then redeploy.

## Dev

```bash
pnpm dev
```

Engine changes are reflected only after they're published. For live
engine-source hot-reload, use `apps/playground` (it aliases the workspace `src`).
