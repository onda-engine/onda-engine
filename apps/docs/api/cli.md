# `onda` CLI

The `onda` CLI is the command-line adapter for the engine: it turns a scene-graph JSON document into a rendered image or video. Run it via `cargo run -p onda-cli -- <args>` (or the built binary `target/release/onda`).

```txt
onda — render a scene-graph document to an image or video

USAGE:
    onda render <scene.json> <out.png>               Render one still
    onda export <movie.json> <out.gif|.mp4>          Render a scene + timeline
    onda export-frames <frames.json> <out.gif|.mp4>  Render pre-evaluated frames
```

## Commands

### `render`

```bash
onda render <scene.json> <out.png> [--backend auto|vello|cpu] [--system-fonts]
```

Renders a single [scene graph](/api/scene-json) to a PNG. Prints the dimensions and the backend used, e.g. `rendered scene.json -> out.png (640x360, vello backend)`.

### `export`

```bash
onda export <movie.json> <out.gif|.mp4> [--backend ...] [--system-fonts]
```

Renders an **animated document** — `{ "scene": ..., "timeline": ... }` — to a video. The timeline's keyframe animations target node `id`s; the frame count comes from the composition's `duration_in_frames`, and `fps` from the composition. Any `<svg>` nodes are expanded once on the template before the timeline is evaluated.

### `export-frames`

```bash
onda export-frames <frames.json> <out.gif|.mp4> [--backend ...] [--system-fonts]
```

Encodes a JSON **array of scene graphs** (one per frame) to a video — exactly what `@onda/react`'s `renderFramesJSON` emits. `fps` is read from the first frame's composition.

```bash
pnpm --filter @onda/react exec tsx examples/animated.tsx frames.json
cargo run -p onda-cli -- export-frames frames.json out.mp4
```

## Options

### `--backend auto|vello|cpu`

Selects the rendering backend (default `auto`).

| Value   | Behavior                                                                 |
| ------- | ------------------------------------------------------------------------ |
| `auto`  | Use Vello (GPU) if an adapter is available, else fall back to CPU (prints a note). |
| `vello` | Force the GPU-native vector backend; **errors if no GPU adapter**. (`gpu` is an alias.) |
| `cpu`   | Force the deterministic CPU reference rasterizer.                        |

The Vello backend does anti-aliased fills/strokes, paths, gradients, clips, and crisp text. The CPU backend is bit-identical and dependency-light but draws fills + text only (no AA/strokes/paths/gradients/clips/rounded corners). See [Backends](/guide/backends).

### `--system-fonts`

Use the host's installed fonts instead of the bundled default font. **CPU backend only**, and it makes output machine-dependent (breaks determinism). Omit it for reproducible output.

### Other flags

| Flag             | Effect                |
| ---------------- | --------------------- |
| `-h`, `--help`   | Print usage.          |
| `-V`, `--version`| Print the version.    |

## Output formats

| Extension | Encoder                | Requirement                          |
| --------- | ---------------------- | ------------------------------------ |
| `.png`    | Built-in (`render`)    | None.                                |
| `.gif`    | Pure Rust              | None — always available.             |
| `.mp4`    | `ffmpeg` (libx264, yuv420p) | `ffmpeg` on `PATH`.             |

If `ffmpeg` isn't installed, MP4 export fails with a clear error — use `.gif`, which needs no external tools.

## SVG resolution

For all three commands, file `src`s on `<svg>` nodes resolve **relative to the input JSON's directory**. Write the scene JSON next to its SVG assets. Inline `markup` is self-contained. See [SVG import](/guide/svg).
