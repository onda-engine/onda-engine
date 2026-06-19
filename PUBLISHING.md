# Publishing & releasing

The `@onda-engine/*` packages are published to the org's **private GitHub Packages** registry (`npm.pkg.github.com`, `access: "restricted"`). Releasing is automated with [Changesets](https://github.com/changesets/changesets): add a changeset, merge the auto-generated "Version Packages" PR, and the packages publish (see [`release-packages.yml`](.github/workflows/release-packages.yml)).

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

## Going public

The packages are source-available (FSL) but published to a **restricted** registry today. The repo's *source* going public is independent of where the *packages* live — pick one path. Everything else (READMEs, keywords, metadata, license) is already prepared, so this is a config flip plus a one-time scope claim.

### Option A — keep GitHub Packages, make it public

- Make the repo public; the packages inherit org visibility.
- Set `"access": "public"` in [`.changeset/config.json`](.changeset/config.json).
- ⚠️ **Caveat:** even *public* npm packages on GitHub Packages still require a GitHub token to `npm install` (a long-standing GH limitation). Fine for known/internal adopters; an auth wall for the public.

### Option B — publish to public npmjs.com  *(recommended for adoption)*

Frictionless `npm install @onda-engine/...`, no auth. One-time setup, then it's automatic forever:

1. **Claim the scope** — create the `onda-engine` org on [npmjs.com](https://www.npmjs.com) (needs your npm account; only you can do this). Generate an automation token and add it as the `NPM_TOKEN` repo secret.
2. **Point publishing at npmjs:**
   - In each `@onda-engine/*` `package.json`, change `publishConfig` to `{ "access": "public" }` (drop the `registry` override so it defaults to `registry.npmjs.org`).
   - Set `"access": "public"` in `.changeset/config.json`.
   - In [`release-packages.yml`](.github/workflows/release-packages.yml), set `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` and configure the npmjs registry (drop the GitHub Packages `.npmrc` scope line for the publish step).
3. **Studio side:** the frontend no longer needs `NODE_AUTH_TOKEN` to install — it pulls from public npmjs. Bump `@onda-engine/components` to `^0.2.x` so prod resolves the current (FSL) major.
4. **Ship it:** `pnpm changeset` (or reuse a pending one) → merge the Version PR → the packages land on npmjs.

### License (decided — FSL-1.1-ALv2)

Functional Source License, Apache-2.0 future. The whole workspace is source-available: the root `LICENSE` holds the FSL text, every `package.json` + the Cargo workspace declare `FSL-1.1-ALv2`, `LICENSE-APACHE` is the 2-year future-license target, and `NOTICE.md` covers the MPL-2.0 deps (`symphonia`, `usvg`). The competing-use carve-out protects Studio; relaxing to Apache/MIT later stays possible, tightening does not.

**Still open before accepting external PRs:** a CLA/DCO bot (so the dual-license / commercial-exception right is retained), plus `SECURITY.md` / `CONTRIBUTING.md` and branch protection on `main`.
