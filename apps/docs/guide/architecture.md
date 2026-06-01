# Architecture

ONDA is a Rust workspace with a small TypeScript/React authoring layer on top. Its defining principle: the **scene graph is the universal language**, and the **renderer is the platform** — everything else (React, the CLI, AI) is an adapter that produces or consumes the scene graph.

## The no-browser pipeline

```txt
React / JSON / AI
        ↓
    Scene Graph        (onda-scene — plain, serde JSON)
        ↓
 Animation Runtime     (onda-animation — evaluate a timeline at a frame → static Scene)
        ↓
  Native Renderer      (onda-vello on GPU, or onda-renderer on CPU)
        ↓
       GPU
        ↓
   Frame Buffer
        ↓
     Encoder           (GIF: pure Rust · MP4: ffmpeg)
        ↓
      Video
```

No DOM. No Chromium. No screenshot pipeline. No browser layout engine.

## Architectural rules

These are enforced by the crate boundaries:

1. **The engine is the source of truth.** Everything consumes the engine; nothing inside it depends on external consumers.
2. **No core crate may depend on React, the browser, the DOM, or AI APIs.** The runtime is framework-agnostic. `onda-scene`, `onda-animation`, and `onda-core` are pure `serde`-serializable data and logic.
3. **React is a *consumer* of ONDA, not ONDA itself.** The same runtime serves React, hand-written JSON, AI, and the CLI without modification.

## The crates

ONDA's Rust crates live under `packages/*-rs` (and `packages/wasm`). The crates that are real and in the build today:

| Crate            | Role |
| ---------------- | ---- |
| **`onda-core`**      | Tiny shared primitives: `Vec2`, `Size`, `Color`, `Transform` (translate + scale; linear-space color helpers). Dependency-light; everything builds on it. |
| **`onda-scene`**     | The scene graph: `Scene`, `Composition`, `Node`, `NodeKind` (`Group` / `Text` / `Image` / `Shape` / `Svg`), `ShapeGeometry` (`Rect` / `Ellipse` / `Path`), `Gradient`, `Stroke`, and `clip`. Plain serde data — the universal language. |
| **`onda-animation`** | The animation runtime: a `Timeline` of keyframe `Track`s targeting nodes by id; `evaluate_frame` collapses it to a static `Scene`. Easings + springs over opacity/translate/scale. |
| **`onda-typography`**| Shaping, layout, and glyph rasterization via `cosmic-text` + `swash`. Bundles Open Sans (SIL OFL 1.1) for deterministic, host-independent text; hands back coverage masks and per-glyph layout. |
| **`onda-renderer`**  | The **CPU reference rasterizer**: deterministic, dependency-light, the correctness oracle. Rects + ellipses + text; no AA/strokes/paths/gradients/clips. Parallel frame rendering via `rayon`. |
| **`onda-vello`**     | The **GPU-native vector backend** (Vello on `wgpu`): AA fills/strokes, rounded rects, paths, gradients, clips, per-glyph vector text. Offscreen render + readback. |
| **`onda-svg`**       | SVG import: `usvg` → flattened `Path` nodes (`import_svg` / `expand_svg`). |
| **`onda-cli`**       | The `onda` command-line adapter: `render` / `export` / `export-frames`, backend selection, GIF/MP4 encoding. |
| **`onda-wasm`**      | The CPU engine compiled to WebAssembly for the browser. |
| **`bench-rs`**       | Benchmarks (compared continuously against Remotion). |

::: tip Crates land when they compile
The workspace only includes crates that build. Other directories named in the founding brief (e.g. `vector-rs`, `codecs-rs`, and the just-scaffolded `audio-rs`) are placeholders that join the workspace once they have real implementations — they are not documented as usable here.
:::

## The TypeScript layer

| Package         | Role |
| --------------- | ---- |
| **`@onda/react`** | A custom React renderer (built on `react-reconciler`) that compiles JSX into scene-graph JSON. Provides the components, hooks, `interpolate`/`spring`, `<Sequence>`/`<Series>`/`<Loop>`, and the `renderToScene*` / `renderFrames*` functions. |

The reconciler maps each component to a host element, then serializes the tree to JSON that round-trips into `onda-scene` exactly (matching field names, snake_case, and the internally-tagged enums). That JSON is what the `onda` CLI renders.

## Why this matters

- **Determinism** — the CPU path is bit-identical across machines (with the bundled font); no time-API patching or compositor warmup.
- **Concurrency** — one process with shared GPU buffers (vs a full browser per worker) means far higher render concurrency per machine.
- **AI-native** — because the scene graph is plain JSON, a prompt can produce a scene directly, without generating source code.

For where this stands against Remotion and the Rust rendering state of the art, see [Why not Remotion?](/guide/why-onda) and the repository's `techspecs/gap-analysis.md`.
