---
title: "Getting started"
---

ONDA ships in two pieces: the **`onda-engine` npm package** — author in React, preview live in the browser on the WASM engine, and render headlessly in Node — and the native **`onda` CLI**, built from the Rust workspace, for GPU render/export to PNG/MP4/GIF. Most users start with the npm package; build from source when you want the native CLI or to hack on the engine.

## Install (npm)

```bash
npm install onda-engine react
```

`react` (v19) is a peer dependency you provide. Everything else — including the ~11 MB of WASM cores — ships in the package; there's no Rust toolchain or extra registry to configure. Author in React and emit scene-graph JSON:

```tsx
import { Composition, Rect, Text, renderToSceneJSON } from 'onda-engine/react'

// …author a <Composition>, then turn it into scene-graph JSON:
const json = renderToSceneJSON(<MyScene />)
```

Preview it live with `<Player>` from `onda-engine/player`, render to video in Node via `onda-engine/render`, or feed the JSON to the native `onda` CLI (below) for GPU export. See [Authoring with React](/guide/authoring-react) for the full component and hook surface.

## Build from source

Everything below is the **from-source** path — needed for the native `onda` CLI (GPU render/export) or to develop the engine itself.

## Prerequisites

- **Rust** (stable, ≥ 1.80) with `cargo` — for the engine and the `onda` CLI.
- **Node.js** (≥ 20) and **pnpm** (the repo pins `pnpm@10.5.0`) — for `@onda-engine/react` authoring.
- **ffmpeg** on your `PATH` — *only* if you want to export MP4. Animated GIF export is pure Rust and needs no external tools.
- A **GPU** for the Vello backend. Without one, ONDA falls back to the deterministic CPU backend.

## 1. Clone and install

```bash
git clone https://github.com/onda-engine/onda-engine
cd onda-engine
pnpm install
```

## 2. Build the Rust workspace

The engine and CLI live in the Cargo workspace. Build (or run) the `onda-cli` crate, whose binary is named `onda`:

```bash
# Build everything in release mode (first build pulls the GPU/encoding deps — give it a few minutes).
cargo build --release

# Or just run the CLI directly through cargo:
cargo run -p onda-cli -- --help
```

The CLI binary is `onda`. Throughout these docs we invoke it as `cargo run -p onda-cli -- <args>`; if you have built it, you can also call the compiled binary at `target/release/onda` directly.

## 3. Render a hand-written scene

A scene graph is plain JSON. Create `scene.json`:

```json
{
  "composition": { "width": 640, "height": 360, "fps": 30, "duration_in_frames": 1 },
  "root": {
    "kind": { "type": "group" },
    "children": [
      {
        "kind": {
          "type": "shape",
          "geometry": { "shape": "rect", "size": { "width": 640, "height": 360 } },
          "fill": { "r": 0.04, "g": 0.05, "b": 0.09 }
        }
      },
      {
        "transform": { "translate": { "x": 40, "y": 120 } },
        "kind": { "type": "text", "content": "Hello ONDA", "font_size": 64, "color": { "r": 1, "g": 1, "b": 1 } }
      }
    ]
  }
}
```

Render it to a PNG:

```bash
cargo run -p onda-cli -- render scene.json out.png
```

You'll see something like `rendered scene.json -> out.png (640x360, vello backend)` (or `cpu backend` if no GPU was found). See the [scene-graph JSON reference](/api/scene-json) for the full schema.

## 4. Author with React instead

Hand-writing JSON gets old fast. `@onda-engine/react` lets you write JSX and emit the same JSON. The example files live in `packages/react/examples/`.

:::caution[Rebuild `@onda-engine/react` before running examples]
The examples import the package's built output (`@onda-engine/react` → `dist/`). After cloning, or after editing the package source, build it first:

```bash
pnpm --filter @onda-engine/react build
```

The `tsx` examples will fail to resolve `@onda-engine/react` until `dist/` exists.
:::

Then run an example. It writes a scene-graph JSON file, which you render with the CLI:

```bash
# Author a still scene → scene-graph JSON
pnpm --filter @onda-engine/react exec tsx examples/hello.tsx out.json

# Render it through the engine
cargo run -p onda-cli -- render out.json out.png
```

For an animation, an example emits an array of per-frame scenes that the CLI encodes to a video:

```bash
pnpm --filter @onda-engine/react exec tsx examples/animated.tsx frames.json
cargo run -p onda-cli -- export-frames frames.json out.mp4
# or, with no external tools:
cargo run -p onda-cli -- export-frames frames.json out.gif
```

## Next steps

- **[Authoring with React](/guide/authoring-react)** — the full component and hook surface.
- **[Rendering & export](/guide/rendering)** — `render` / `export` / `export-frames` and the backends.
- **[The scene graph](/concepts/scene-graph)** — understand the representation everything compiles to.
- **[Examples](/examples/)** — runnable walkthroughs mirroring `packages/react/examples/`.
