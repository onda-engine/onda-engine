# Publishing

The ONDA engine packages are **not published yet** — every `@onda/*` package is at `0.0.0` and the workspace root is `private`. This repo is wired with [Changesets](https://github.com/changesets/changesets) so that *if/when* you decide to publish, it's a deliberate, versioned, one-command flow. **Nothing publishes automatically.**

## Two distribution paths — don't confuse them

| | What it is | Who consumes it | How it's produced |
|---|---|---|---|
| **Embed kit** | A prebuilt **linux** tarball: the bundled `onda-engine.js` + the native `onda` binary + wasm + fonts | **Onda Studio** (and any app embedding the engine at runtime) | Already automated — [`release.yml`](.github/workflows/release.yml) builds it on a `v*` tag, smoke-tests it on lavapipe, and attaches it to a GitHub Release. **No npm involved.** |
| **npm packages** | `@onda/react`, `@onda/components`, `@onda/cinema`, `@onda/render`, `@onda/player`, `@onda/wasm*` on the npm registry | **External developers** who `npm install` the engine | This document. Only relevant if you go public / open. |

**The Studio never needs npm** — it vendors the embed kit. npm publishing is purely the "let other people build on the engine" lever, fully decoupled from your own deploy.

## Safety — why nothing leaks by accident

- Root `package.json` is `private: true` — the workspace root can never be published.
- `.changeset/config.json` sets `access: "restricted"` — even a deliberate `changeset publish` goes out **scoped/private**, not public source, until you change it.
- There is **no publish step in CI**. Publishing happens only when *you* run the commands below.

## Prerequisites (before the first publish)

1. **Own the `@onda` scope on npm** and `npm login`.
2. **Decide the license first.** The repo declares `MIT OR Apache-2.0`, but the root `LICENSE` is MIT-only with a personal copyright — reconcile that. (The strategy notes recommend *source-available*, e.g. a Remotion-style company license, for the engine **core** rather than fully permissive; permissive is fine for the leaf component/format layer.) Add a `NOTICE` for the MPL-2.0 dependencies (`symphonia`, `usvg`).
3. **Choose public vs. restricted.** To publish open/public, set `"access": "public"` in `.changeset/config.json`. Leaving it `"restricted"` keeps the packages private.

## The flow

```bash
pnpm install                 # installs @changesets/cli (first time only)

# 1. Describe your changes — pick packages + bump type; writes a markdown file you commit
pnpm changeset

# 2. Apply: bump versions + write CHANGELOGs (review, then commit)
pnpm changeset:version

# 3. Build everything + publish the changed packages to npm
pnpm changeset:publish
```

Notes:
- `apps/*` are `private`, so Changesets ignores them.
- The Rust crates (`packages/*-rs`) are Cargo packages, **not** npm — publish them (if ever) via `cargo publish`, separately.
- `@onda/*` internal deps use `workspace:*`; Changesets rewrites those to real version ranges at publish time.
