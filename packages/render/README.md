# @onda-engine/render

Render `@onda-engine/react` compositions to a **video or still file** via the native ONDA engine — the no-Chromium equivalent of Remotion's `renderMedia`. A Node-side wrapper that drives the native `onda` CLI, so a render is a scene graph straight to the GPU, not a headless browser screenshotting frames.

[Docs](https://onda.video) · [GitHub](https://github.com/onda-engine/onda-engine) · [Onda Studio](https://studio.onda.video)

## Install

```bash
npm install @onda-engine/render @onda-engine/react
```

> **Runtime requirements:** the native `onda` binary (shipped via the [embed kit](https://github.com/onda-engine/onda-engine#embedding-the-engine)) and `ffmpeg` on `PATH` for encode/decode.

## Usage

Point it at a composition and an output path; it emits per-frame scene JSON and drives the CLI to encode an MP4 (or PNG/GIF). See the [rendering guide](https://onda.video) for the full API and backend options (`vello` / `cpu`).

---

Part of **[ONDA](https://github.com/onda-engine/onda-engine)** — a GPU-native, browser-free motion-graphics engine (React → scene graph → native GPU render). ONDA also powers **[Onda Studio](https://studio.onda.video)**, an AI motion-graphics studio — _"Lovable for video."_

Source-available under the **[Functional Source License](https://github.com/onda-engine/onda-engine/blob/main/LICENSE)** (FSL-1.1-Apache-2.0): use it, self-host it, build non-competing products; each release turns Apache-2.0 two years after it ships.
