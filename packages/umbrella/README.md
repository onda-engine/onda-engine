<div align="center">

<img src="https://raw.githubusercontent.com/onda-engine/onda-engine/main/assets/brand/readme-hero.svg" alt="ONDA Engine — motion graphics at GPU speed, no browser" width="100%" />

<br/>

### Motion graphics at GPU speed. No browser. No Chromium.

**Author video in React → compile it to a scene graph → render it natively on the GPU.**
One `npm install` for the entire engine.

[![npm](https://img.shields.io/npm/v/onda-engine?style=flat-square&labelColor=0e0e12&color=d96b82)](https://www.npmjs.com/package/onda-engine)
[![license: FSL-1.1-Apache-2.0](https://img.shields.io/badge/license-FSL--1.1--Apache--2.0-d96b82?style=flat-square&labelColor=0e0e12)](#license--read-this-first)
[![types: included](https://img.shields.io/badge/types-included-d96b82?style=flat-square&labelColor=0e0e12)](#whats-in-the-box)
[![renderer: Vello GPU](https://img.shields.io/badge/renderer-Vello_GPU-d96b82?style=flat-square&labelColor=0e0e12)](#why-onda)

[Why ONDA](#why-onda) &nbsp;·&nbsp; [Install](#install) &nbsp;·&nbsp; [What's in the box](#whats-in-the-box) &nbsp;·&nbsp; [Onda Studio](#onda-studio) &nbsp;·&nbsp; [License](#license--read-this-first) &nbsp;·&nbsp; [onda.video](https://onda.video)

</div>

---

**ONDA turns a React composition into a renderer-agnostic _scene graph_, then rasterizes it with a native GPU renderer ([Vello](https://github.com/linebender/vello))** — or a deterministic CPU reference renderer, or a WebAssembly path for live in-browser preview. No DOM. No headless browser. No screenshot round-trip. Just a scene graph, straight to the GPU.

`onda-engine` is the **all-in-one** package — the React renderer, the motion-language component library, the interactive player, the headless renderer, and the WASM cores — bundled into a single install, one version.

> **Pre-1.0.** The Rust + WASM core already powers a production studio, but the public API isn't frozen — expect breaking changes before `1.0`.

## Why ONDA

Programmatic video today (e.g. Remotion) renders by driving a **headless browser**: correct, but heavy — a Chromium process per render, slow cold starts, high memory, painful to scale. ONDA keeps the **React authoring model** you already know, but compiles it to a scene graph and renders it **natively**. There is no browser anywhere in the pipeline.

> **It's faster because it does less.** Measured on an Apple M4 Pro (1080p, Remotion's best case): **~4.5× faster per thread** and **~9.3× higher machine throughput** than Remotion — and the gap *widens* with scene complexity, GPU acceleration, and cold-start / memory pressure.

The scene graph is the universal language; the renderer is the platform. **One composition** drives them all — live browser preview (WebGPU / WASM), native GPU export, or a deterministic CPU reference render.

Beyond synthetic motion graphics, ONDA edits **real footage** — cut, trim, and retime video clips on a timeline, mix and trim audio, and finish with a cinematic effect chain (grade, bloom, grain, light-wrap). It also exposes **measurement** APIs — geometry lint, colour scopes (luma/RGB histograms + clipping), and audio loudness — so a tool or agent can judge a render by the numbers, not by eye.

## Install

```bash
npm install onda-engine react
```

`react` (v19) is a peer dependency you provide. Everything else — including the ~11 MB of WASM cores — ships in the box. No runtime downloads, no extra registry to configure, no Rust toolchain on your machine.

## What's in the box

| Import | What it is |
| --- | --- |
| `onda-engine` | The Onda **motion language** — choreography + component library (the main authoring surface) |
| `onda-engine/react` | The React → scene-graph renderer (`renderToScene`, primitives, hooks) |
| `onda-engine/player` | Interactive `<Player>` — real-time canvas / WebGPU preview |
| `onda-engine/render` | **Node-only** headless render to video / still (no Chromium) |
| `onda-engine/cinema` | Render a timeline composition payload to an engine element |
| `onda-engine/components/manifest` | Per-component prop manifest (semantic roles) |
| `onda-engine/wasm` · `/wasm-audio` · `/wasm-vello` | The renderer, audio FFT, and Vello GPU cores, compiled to WebAssembly |

## Usage

```tsx
import { TitleCard } from 'onda-engine'
import { renderToScene } from 'onda-engine/react'

const scene = renderToScene(<TitleCard title="Hello, motion" />)
```

**The WASM loads itself.** Under a bundler that supports the `new URL(..., import.meta.url)` asset convention (Vite, modern webpack), each `.wasm` ships next to its glue and is fetched automatically — nothing to wire up:

```ts
import { preloadTextMetrics, measureText } from 'onda-engine'

await preloadTextMetrics()   // locates + instantiates the wasm core
measureText('Hello', 48)     // real shaped glyph metrics
```

> **`onda-engine/render` is Node-only** — it uses `fs`, `child_process`, and ffmpeg. Don't import it into browser code; use it from a server or CLI.

## Onda Studio

ONDA is the **engine**; **[Onda Studio](https://studio.onda.video)** is the **director**.

Studio is an AI motion-graphics studio — *"Lovable for video."* Describe a scene in plain language and an agent composes, renders, and ships it — frame-accurate, on this exact engine. The engine stands on its own as a programmatic-video toolkit; Studio is what it makes possible.

## Requirements

- **React 19** (peer dependency)
- A bundler that handles `.wasm` assets for browser use (**Vite** recommended), or **Node ≥ 20** for server-side rendering
- **WebGPU** for the GPU (`wasm-vello`) path; the CPU core (`wasm`) is the always-available fallback

## License — read this first

**Source-available — _not_ open source.** `onda-engine` is licensed under the **[Functional Source License](https://raw.githubusercontent.com/onda-engine/onda-engine/main/LICENSE)** (`FSL-1.1-Apache-2.0`):

- ✅ **You may** read, run, self-host, modify, and build **non-competing** products with it — freely, no fee.
- 🚫 **You may not** use it to make a product that **competes** with ONDA.
- ⏳ **It turns into Apache-2.0:** each release automatically converts to full [Apache-2.0](https://raw.githubusercontent.com/onda-engine/onda-engine/main/LICENSE-APACHE) **two years** after it ships.

If you need terms beyond the FSL grant, get in touch via [onda.video](https://onda.video).

---

<div align="center">
  <img src="https://raw.githubusercontent.com/onda-engine/onda-engine/main/assets/brand/onda-mark.svg" alt="ONDA" width="34" />
  <br/><br/>
  <sub><b>ONDA</b> &nbsp;·&nbsp; Motion graphics at GPU speed &nbsp;·&nbsp; <a href="https://onda.video">onda.video</a></sub>
</div>
