# Rendering & export

The `onda` CLI is the command-line **adapter** for the engine. Per the charter, the scene graph is the universal language and the renderer is the platform; the CLI just turns a scene-graph JSON document into a rendered image or video. Anything that emits that JSON — `@onda/react`, an AI system, a hand-authored file — renders the same way.

Invoke it via `cargo run -p onda-cli -- <args>`, or call the built binary at `target/release/onda` after `cargo build --release`.

## Commands

### `onda render` — one still

Renders a single scene-graph JSON document to a PNG.

```bash
onda render <scene.json> <out.png> [--backend auto|vello|cpu] [--system-fonts]
```

```bash
cargo run -p onda-cli -- render scene.json out.png
# rendered scene.json -> out.png (640x360, vello backend)
```

The input is a scene graph (see the [scene-graph JSON reference](/api/scene-json)). Output must be a `.png`.

### `onda export` — a scene + timeline

Renders an **animated document** (`{ "scene": ..., "timeline": ... }`) to a video. The timeline is evaluated per frame, then encoded.

```bash
onda export <movie.json> <out.gif|out.mp4> [--backend ...] [--system-fonts]
```

The `movie.json` shape is a scene plus a `timeline` of keyframe animations targeting node ids. The number of frames comes from the composition's `duration_in_frames`, and `fps` from the composition.

### `onda export-frames` — pre-evaluated frames

Encodes a **JSON array of scene graphs** (one per frame) to a video. This is exactly what `@onda/react`'s `renderFramesJSON` emits, so it's the usual path for React-authored animations.

```bash
onda export-frames <frames.json> <out.gif|out.mp4> [--backend ...] [--system-fonts]
```

```bash
pnpm --filter @onda/react exec tsx examples/animated.tsx frames.json
cargo run -p onda-cli -- export-frames frames.json out.mp4
```

The `fps` is taken from the first frame's composition.

## Output formats

| Extension | Encoder                         | Requirements                         |
| --------- | ------------------------------- | ------------------------------------ |
| `.png`    | Built-in (still, `render` only) | None.                                |
| `.gif`    | Pure Rust                       | None — always available.             |
| `.mp4`    | Shells out to `ffmpeg`          | `ffmpeg` on your `PATH` (libx264, yuv420p). |

::: tip ffmpeg note
MP4 export writes PNG frames to a temp directory and invokes `ffmpeg` (`-c:v libx264 -pix_fmt yuv420p`, padding to even dimensions). If `ffmpeg` isn't installed you'll get a clear error — use `.gif` instead, which needs no external tools.
:::

## Options

### `--backend auto|vello|cpu`

Chooses the rendering backend (default `auto`).

- **`auto`** — use the GPU-native **Vello** backend if a GPU adapter is available, otherwise fall back to the CPU backend (it prints a note when it falls back).
- **`vello`** — force the GPU backend; errors if no GPU adapter is found. (`gpu` is accepted as an alias.)
- **`cpu`** — force the deterministic CPU reference rasterizer.

The command's output line reports which backend actually ran, e.g. `... (vello backend)`. See [Backends](/guide/backends) for what each can and cannot draw.

### `--system-fonts`

Use the host's installed fonts instead of the bundled default font. This affects the **CPU backend** only, and makes output machine-dependent (so it breaks determinism). Without it, the bundled font is used for reproducible results.

## A note on determinism

The CPU backend produces **bit-identical** output across runs and machines (with the bundled font). That makes it the engine's correctness oracle and the right choice when you need reproducibility. The GPU backend produces higher-quality, anti-aliased vector output but is not guaranteed bit-identical across GPUs/drivers. See [Backends](/guide/backends).
