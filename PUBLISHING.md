# Publishing & releasing

The `@onda-engine/*` packages are published — **v0.1.0 on the org's private GitHub Packages** registry (`npm.pkg.github.com`, `access: "restricted"`). Releasing is automated with [Changesets](https://github.com/changesets/changesets): add a changeset, merge the auto-generated "Version Packages" PR, and the packages publish (see [`release-packages.yml`](.github/workflows/release-packages.yml)).

## Two distribution paths — don't confuse them

| | What it is | Who consumes it | How it's produced |
|---|---|---|---|
| **npm packages** | `@onda-engine/{react,components,cinema,render,player,wasm,wasm-vello,wasm-audio}` on the org's **private GitHub Packages** | **Onda Studio's frontend** (installs them in CI/Vercel; dev aliases to this sibling repo for live edits) — and external devs, if/when public | **Automatic** via Changesets — see the flow below. |
| **Embed kit** | A prebuilt **linux** tarball: the bundled `onda-engine.js` + the native `onda` binary + wasm + fonts | **Onda Studio's backend** render pipeline (and any app embedding the engine at runtime) | [`release.yml`](.github/workflows/release.yml) builds it on a `v*` tag, smoke-tests it on lavapipe, attaches it to a GitHub Release. **No npm involved.** |

## ⚠️ Changed something in the embed kit? Re-tag it.

**The backend renders from the pinned embed kit, NOT from the npm packages.** So if you change the **`onda` binary** or the **core compose/render packages the bundle inlines** (`components`, `cinema`, `render`), you must:

1. Push a new **`v*` tag** → `release.yml` rebuilds + re-releases the kit (~90 min).
2. Bump Onda Studio's backend **`ONDA_KIT_VERSION`** (in `backend/Dockerfile`) to that tag.

Otherwise the backend keeps rendering with the **old** bundle. **Frontend-only changes** (the in-browser `player`, `wasm-vello`, docs) do **not** need a kit rebuild — they reach the frontend through the npm packages automatically. (We chose this reminder over auto-unifying the two releases because kit-relevant changes are rare — the render core is stable vs. the fast-moving frontend.)

## The release flow (npm packages → frontend)

Automatic, on merge to `main`:

```bash
pnpm changeset          # describe the change: pick packages + bump type (writes a file you commit)
git push                # → the "Version Packages" PR appears (bumps versions + writes CHANGELOGs)
# merge that PR         # → release-packages.yml publishes @onda-engine/* to GitHub Packages
```

Manual equivalent (if ever needed): `pnpm changeset:version` then `pnpm changeset:publish`.

Notes:

- `apps/*` are `private`, so Changesets ignores them.
- The Rust crates (`packages/*-rs`) are Cargo packages, **not** npm — `cargo publish` separately if ever.
- `@onda-engine/*` internal deps use `workspace:*`; Changesets rewrites those to real version ranges at publish time.
- Publish auth: CI uses the built-in `GITHUB_TOKEN` (`packages: write`); locally it's `NODE_AUTH_TOKEN` (a token with `write:packages`) read from `.npmrc`.

## Going public later

The packages are **private** today (`access: "restricted"` + private repo). To open them:

1. **License: decided — FSL-1.1-ALv2** (Functional Source License, Apache-2.0 future). The whole workspace is source-available: the root `LICENSE` holds the FSL text, every `package.json` + the Cargo workspace declare `FSL-1.1-ALv2`, `LICENSE-APACHE` is the 2-year future-license target, and `NOTICE.md` covers the MPL-2.0 deps (`symphonia`, `usvg`). The competing-use carve-out protects Studio; relaxing to Apache/MIT later stays possible, tightening does not. **Still open:** put external contributors on a CLA/DCO before accepting PRs (so the dual-license/commercial-exception right is retained).
2. Flip `"access": "public"` in `.changeset/config.json` (and/or publish to public npm under a claimable scope — note GitHub Packages requires the scope to match the org, hence `@onda-engine`).
