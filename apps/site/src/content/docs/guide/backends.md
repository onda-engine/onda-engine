---
title: "Backends"
---

ONDA ships two rendering backends. Both consume the same scene graph; they differ in capability and determinism. Choose with `--backend auto|vello|cpu`.

## Vello (GPU) — the vector backend

`onda-vello` is ONDA's GPU-native vector backend. It maps an ONDA scene onto a `vello::Scene` and rasterizes it on the GPU (compute) to an RGBA framebuffer. It does **true vector rendering**:

- **Anti-aliased fills *and* strokes**
- **Real rounded rectangles** (`cornerRadius`)
- **Arbitrary Bézier paths** (`<Path>` / `ShapeGeometry::Path`)
- **Linear & radial gradients** (`gradient` paint)
- **Clip regions** (the `clip` prop — any geometry as a mask)
- **Native per-glyph vector text** — glyph outlines drawn through Vello's glyph runs, resolution-independent and ready for per-character/kinetic animation

It renders offscreen and reads the frame back into a framebuffer, so the existing GIF/MP4 encoders apply unchanged.

**Requires a GPU adapter.** `--backend vello` errors if none is found; `--backend auto` falls back to CPU.

## CPU — the deterministic reference

`onda-renderer` is the CPU reference rasterizer. It walks the scene and produces an in-memory RGBA8 framebuffer with **no GPU**, deliberately dependency-light, so the scene-graph → pixels *contract* can be pinned down and tested. It is the **correctness oracle** the GPU backend is checked against.

It is intentionally limited. The CPU backend draws:

- Filled **rectangles** and **ellipses** (square corners only)
- **Text**, composited from `onda-typography` coverage masks

And it **does not** draw:

- **Anti-aliasing** — hard (aliased) edges
- **Strokes**
- **Paths** (`<Path>`) — skipped entirely
- **Gradients** — falls back to the **first stop's color**
- **Clips** — ignored
- **Rounded corners** — `cornerRadius` is ignored

## Which to use

| You want…                                         | Use            |
| ------------------------------------------------- | -------------- |
| Highest visual quality (AA, paths, gradients, clips, crisp text) | **`vello`** |
| Bit-identical, reproducible output across machines | **`cpu`** (bundled font) |
| Sensible default that picks the GPU when present   | **`auto`** (the default) |

## The determinism caveat

The CPU backend is **bit-identical** across runs and machines when using the bundled default font — which is why it's the reference oracle and the right pick for reproducible pipelines. Passing `--system-fonts` uses the host's fonts and makes CPU output machine-dependent.

The GPU (Vello) backend gives far better quality but is **not guaranteed bit-identical** across different GPUs and drivers. If you need reproducibility, render on the CPU; if you need quality and have a GPU, render with Vello.

:::caution[Backend-specific features]
`<Path>`, `gradient`, `clip`, `stroke`, `cornerRadius`, and anti-aliased text are **GPU-only** today. If you render a path-only scene on the CPU backend, the canvas stays transparent. The `auto` default sidesteps this whenever a GPU is present.
:::
