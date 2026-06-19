# Contributing to ONDA

Thanks for your interest! ONDA is a GPU-native, browser-free motion-graphics engine — **pre-1.0** and source-available under the [Functional Source License](LICENSE). Contributions are welcome within that frame.

> **Open an issue first** for anything non-trivial. The API isn't frozen before 1.0, so a quick discussion saves us both rework.

## Development setup

**Toolchain:** [pnpm](https://pnpm.io) 10 · Rust (`cargo`, stable) · and for the `speak` / `transcribe` / `segment` CLI features: `cmake`, `clang`, `espeak-ng`. `ffmpeg` is needed **at runtime** for video.

```bash
pnpm install
pnpm -r build                        # all TypeScript packages
cargo build --release -p onda-cli    # the native `onda` CLI
```

## Before you push — run what CI runs

```bash
pnpm format                          # Biome (CI fails on format drift)
pnpm -r typecheck
cargo fmt --check && cargo clippy --workspace && cargo test --workspace
```

CI additionally runs a **golden-frame determinism** test and a **headless render smoke** (Vello on lavapipe) — server-side rendering is proven on every change. PRs must be green across **Rust**, **TS**, and **Render smoke**.

## Pull requests

- Branch off `main`; keep PRs focused and explain the _why_.
- **Add a changeset** for any change to a published `@onda-engine/*` package: `pnpm changeset` → pick the packages, the bump type, and a one-line note. (Skip for docs, the site, or internal-only changes.) See [PUBLISHING.md](PUBLISHING.md).
- Match the surrounding code; no new lint or type errors.

## Sign off your commits (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/). Sign off every commit:

```bash
git commit -s -m "your message"
```

This certifies you wrote the patch (or may submit it) and that it's contributed under the project's license. _(A CLA may be introduced before 1.0 to keep dual-licensing options open — we'll note it here if so.)_

## Project layout

- `packages/*` — TypeScript packages (`@onda-engine/*`) and Rust crates (`*-rs`). See the [package map](README.md#packages).
- `apps/site` — the docs + marketing site ([onda.video](https://onda.video)).
- Releases are automated with Changesets — see [PUBLISHING.md](PUBLISHING.md).

By contributing, you agree your contributions are licensed under the repo's [FSL](LICENSE) (FSL-1.1-Apache-2.0).
