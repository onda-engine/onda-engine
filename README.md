# ONDA Engine

> A GPU-native, browser-free motion-graphics engine. **Author compositions in React, render them natively** — no headless Chromium.

ONDA turns a React composition into a **scene-graph** and renders it with a native GPU rasterizer ([Vello](https://github.com/linebender/vello)) — or a CPU reference renderer, or a WASM path for in-browser preview. The scene graph is the universal language; the renderer is the platform.

It's the engine behind **Onda Studio** ("Lovable for video") — an AI motion-graphics studio — but it stands on its own as a programmatic-video toolkit.

> **Status: pre-1.0.** APIs are unstable, packages are unversioned (`0.0.0`), and nothing is published to npm yet. Expect breaking changes.

---

## Why

Programmatic video today (e.g. Remotion) renders by driving a **headless browser** — correct, but heavy: a Chromium per render, slow startup, high memory. ONDA keeps the **React authoring model** (you describe a frame as a component over time) but compiles it to a renderer-agnostic scene graph and rasterizes it **natively**:

- **No browser** — render on a small box or in CI; no Chromium to install or babysit.
- **One scene graph, many targets** — the same JSON renders on the GPU (Vello), the CPU reference rasterizer, or WASM in the browser for live preview.
- **Native speed** — Rust rasterization + a direct `ffmpeg` encode path.

## How it works

```
@onda/react            @onda/cinema           packages/*-rs (Rust)
  React JSX    ──▶   scene-graph JSON   ──▶   renderer (Vello GPU / CPU)  ──▶  ffmpeg  ──▶  out.mp4
                          │
                          └──▶  @onda/wasm  ──▶  in-browser preview (no server)
```

A custom React reconciler (`@onda/react`) compiles JSX into scene-graph JSON. `@onda/cinema` compiles a higher-level composition spec (timeline of scenes/entries/motion) into that scene graph. The `onda` CLI (`packages/cli-rs`) rasterizes a scene and encodes it; `@onda/render` is the Node wrapper that drives the CLI for exports.

## Packages

**TypeScript** (`packages/`, pnpm workspace):

| Package | What it is |
|---|---|
| `@onda/react` | Custom React reconciler — JSX → scene-graph JSON |
| `@onda/components` | The motion-graphics component + choreography library (titles, kinetic type, gradients, charts, transitions…) |
| `@onda/cinema` | Composition spec → engine scene compiler (choreography, camera, 2.5D depth, finish) |
| `@onda/render` | Node wrapper that drives the native `onda` CLI to export MP4/PNG |
| `@onda/player` | In-browser preview surface |
| `@onda/wasm`, `@onda/wasm-vello`, `@onda/wasm-audio` | WASM bindings (text metrics, raster, audio) for the browser preview path |

**Rust** (`packages/*-rs`, Cargo workspace):

| Crate | What it is |
|---|---|
| `vello-rs` | GPU rasterizer over Vello/wgpu — plus 3D perspective, glyph extrusion, mesh tessellation |
| `renderer-rs` | CPU reference rasterizer |
| `cli-rs` | The `onda` CLI — `render`, `speak`, `transcribe`, `segment`, lint, export orchestration |
| `typography-rs`, `layout-rs`, `animation-rs`, `vector-rs`, `svg-rs`, `image-rs` | Text shaping, layout, choreography sampling, geometry |
| `scene-rs`, `core-rs` | The scene-graph IR — the contract every layer speaks |
| `audio-rs`, `codecs-rs`, `video-rs` | Audio decode/mix/synth, codec glue, native A-roll decode (shells to `ffmpeg`) |
| `tts-rs`, `transcribe-rs`, `segment-rs` | Kokoro voiceover, Whisper transcription, U²-Net subject segmentation (ONNX) |

## Build

**Toolchain:** `pnpm 10`, Rust (`cargo`), and — for the `speak`/`transcribe`/`segment` CLI features — `cmake`, `clang`, and `espeak-ng` (+ data). `ffmpeg` is needed **at runtime** for video encode/decode.

```bash
pnpm install
pnpm -r build        # build all TS packages

# native CLI (full feature set):
cargo build --release -p onda-cli --features segment,video,transcribe,speak

# render a scene
./target/release/onda render scene.json out.mp4
```

> ML model weights (Whisper ~142 MB, Kokoro ~325 MB, U²-Net ~176 MB) are **not** bundled — they download once at first use to `~/.onda/models/`.

### Embedding the engine in an app

Downstream apps don't install these packages from a registry — they consume a **vendored embed-kit**: a single bundled JS entry (`onda-engine.js`, with the TS packages inlined) plus the prebuilt native `onda` binary, WASM, and fonts. Build it with:

```bash
scripts/build-embed-kit.sh                 # → dist/embed-kit/
scripts/build-embed-kit.sh --skip-binary   # JS/d.ts/wasm only (no cargo build)
```

Drop the output into the host app and import it by path — no Rust toolchain or engine source required on the deploy side.

## License

See [LICENSE](./LICENSE). _(Licensing is being finalized ahead of any public release.)_
