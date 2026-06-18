# ONDA Engine — Claude Code Configuration

Open-source, GPU-native, browser-free motion-graphics engine in Rust. Author
compositions in React (`@onda-engine/react`) → scene-graph JSON → native GPU renderer
(Vello) or CPU reference, with a wasm path for in-browser preview. The scene
graph is the universal language; the renderer is the platform.

## Layout

- Rust workspace (`Cargo.toml`) — crates in `packages/*-rs` (core, scene,
  renderer, vello, typography, animation, svg, image, layout, audio, cli, bench)
  + `packages/wasm`, `packages/wasm-vello` (wasm bindings).
- TS/pnpm monorepo — `packages/{react,player}` and `apps/{site,playground,benchmark}`.
- Site (landing + docs) is `apps/site` (Astro + Starlight, static).

## Rules

- Do what has been asked; nothing more, nothing less.
- Prefer editing existing files; don't create files (esp. docs) unless needed.
- Keep new files out of the repo root — use the right `packages/`/`apps/` dir.
- ALWAYS read a file before editing it.
- NEVER commit secrets, credentials, or `.env` files.
- NEVER add a `Co-Authored-By` (or any AI co-author) trailer to commits.
- Keep files focused; validate input at system boundaries.

## Build & test

```bash
cargo fmt && cargo clippy --all-targets   # Rust
cargo test -p <crate>                      # per-crate tests
pnpm --filter @onda-engine/react build && pnpm --filter @onda-engine/react test
pnpm exec biome check --write <paths>      # TS lint/format
```

- Run the relevant tests after code changes and verify the build before committing.
- Commit locally only; do not push unless explicitly asked.
- wasm crates must keep building for `wasm32-unknown-unknown` (browser preview is
  a core path); feature-gate native-only deps.
