# onda-engine

**Author motion graphics in React. Render them natively on the GPU — no headless browser, no Chromium.**

[![npm](https://img.shields.io/npm/v/onda-engine?style=flat-square&labelColor=0e0e12&color=d96b82)](https://www.npmjs.com/package/onda-engine)
[![License](https://img.shields.io/badge/license-FSL--1.1--Apache--2.0-d96b82?style=flat-square&labelColor=0e0e12)](#license)

ONDA turns a **React composition** into a renderer-agnostic **scene graph**, then rasterizes it with a native GPU renderer ([Vello](https://github.com/linebender/vello)) — or a deterministic CPU reference renderer, or a WASM path for live in-browser preview. It's the engine behind **[Onda Studio](https://studio.onda.video)**, but it stands on its own as a programmatic-video toolkit.

This is the **all-in-one** package: the React renderer, the motion-language components, the interactive player, the headless renderer, and the WASM core — one install, one version.

> **Pre-1.0.** The Rust + WASM core powers a production studio, but the public API isn't frozen — expect breaking changes before 1.0.

## Install

```bash
npm install onda-engine react
```

`react` (v19) is a peer dependency — you provide it. Everything else, including the ~11 MB of WASM, ships in the box; there's no runtime download and no extra registry to configure.

> The engine is developed as granular [`@onda-engine/*`](https://github.com/onda-engine/onda-engine) workspace packages; `onda-engine` bundles them into a single public install (one package, one version) — this is the package you install.

## What's inside

| Import | What it is |
| --- | --- |
| `onda-engine` | The Onda **motion language** — choreography + component library (the main authoring surface) |
| `onda-engine/react` | The React → scene-graph renderer (`renderToScene`, primitives, hooks) |
| `onda-engine/player` | Interactive `<Player>` — real-time canvas/WebGPU preview |
| `onda-engine/render` | **Node-only** headless render to video/still (no Chromium) |
| `onda-engine/cinema` | Render a timeline composition payload to an engine element |
| `onda-engine/components/manifest` | Per-component prop manifest (semantic roles) |
| `onda-engine/wasm` | The renderer compiled to WebAssembly (text metrics, CPU render) |
| `onda-engine/wasm-audio` | Audio decode + FFT (audio-reactive visuals) |
| `onda-engine/wasm-vello` | The Vello GPU renderer over WebGPU |

## Usage

```tsx
import { TitleCard } from 'onda-engine'
import { renderToScene } from 'onda-engine/react'

const scene = renderToScene(<TitleCard title="Hello" />)
```

### WASM (browser)

Under a bundler that supports the `new URL(..., import.meta.url)` asset convention (Vite, modern webpack), the WASM **loads itself** — each `.wasm` ships next to its glue and is fetched automatically. Nothing to wire up:

```ts
import { preloadTextMetrics, measureText } from 'onda-engine'

await preloadTextMetrics()      // locates + instantiates the wasm core
measureText('Hello', 48)        // real shaped metrics
```

If you'd rather pass the binary URL explicitly (e.g. to control caching), the assets are addressable too:

```ts
import wasmUrl from 'onda-engine/wasm/pkg/onda_wasm_bg.wasm?url'
import init, { OndaEngine } from 'onda-engine/wasm'

await init(wasmUrl)
const engine = new OndaEngine()
```

### `onda-engine/render` is Node-only

The headless renderer uses `fs`, `child_process`, and ffmpeg — **do not import it into browser code** (your bundler will try to externalize Node built-ins and fail). Use it from a server/CLI:

```ts
import { renderToFile } from 'onda-engine/render'
```

## Requirements

- **React 19** (peer dependency)
- A bundler that handles `.wasm` assets for browser use (Vite recommended), or Node ≥ 20 for server-side use
- WebGPU for the GPU (`wasm-vello`) path; the CPU path (`wasm`) is the fallback

## License

[FSL-1.1-Apache-2.0](./LICENSE) — source-available, converting to Apache-2.0 over time. © Rodrigo Botelho.
