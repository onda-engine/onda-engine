---
title: "Getting started"
---

ONDA is an early-stage **Rust workspace** with a TypeScript/React authoring layer. There is no published npm package or prebuilt binary yet — you build it from source. This page walks through cloning the repo, building the workspace, and rendering your first scene.

## Prerequisites

- **Rust** (stable, ≥ 1.80) with `cargo` — for the engine and the `onda` CLI.
- **Node.js** (≥ 20) and **pnpm** (the repo pins `pnpm@10.5.0`) — for `@onda/react` authoring.
- **ffmpeg** on your `PATH` — *only* if you want to export MP4. Animated GIF export is pure Rust and needs no external tools.
- A **GPU** for the Vello backend. Without one, ONDA falls back to the deterministic CPU backend.

## 1. Clone and install

```bash
git clone https://github.com/degueba/onda-engine
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

Hand-writing JSON gets old fast. `@onda/react` lets you write JSX and emit the same JSON. The example files live in `packages/react/examples/`.

:::caution[Rebuild `@onda/react` before running examples]
The examples import the package's built output (`@onda/react` → `dist/`). After cloning, or after editing the package source, build it first:

```bash
pnpm --filter @onda/react build
```

The `tsx` examples will fail to resolve `@onda/react` until `dist/` exists.
:::

Then run an example. It writes a scene-graph JSON file, which you render with the CLI:

```bash
# Author a still scene → scene-graph JSON
pnpm --filter @onda/react exec tsx examples/hello.tsx out.json

# Render it through the engine
cargo run -p onda-cli -- render out.json out.png
```

For an animation, an example emits an array of per-frame scenes that the CLI encodes to a video:

```bash
pnpm --filter @onda/react exec tsx examples/animated.tsx frames.json
cargo run -p onda-cli -- export-frames frames.json out.mp4
# or, with no external tools:
cargo run -p onda-cli -- export-frames frames.json out.gif
```

## Next steps

- **[Authoring with React](/guide/authoring-react)** — the full component and hook surface.
- **[Rendering & export](/guide/rendering)** — `render` / `export` / `export-frames` and the backends.
- **[The scene graph](/concepts/scene-graph)** — understand the representation everything compiles to.
- **[Examples](/examples/)** — runnable walkthroughs mirroring `packages/react/examples/`.
