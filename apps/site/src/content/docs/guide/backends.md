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

`onda-renderer` is the CPU reference rasterizer, built on **tiny-skia** (the Skia raster pipeline) + kurbo — no GPU, deliberately dependency-light, so the scene-graph → pixels *contract* can be pinned down and tested. It is the **correctness oracle** the GPU backend is checked against, and it is far from a toy: across the bulk of the surface it is **byte-identical to Vello**.

The CPU backend draws, matching Vello pixel-for-pixel:

- **Anti-aliased fills _and_ strokes** (cap / join / dash)
- **Real rounded rectangles** (`cornerRadius`)
- **Arbitrary Bézier paths** (`<Path>`)
- **Linear & radial gradients**
- **Native text** and **images**
- The full per-pixel **[effect chain](/guide/effects)** — blur, directional blur, bloom, color-grade, grain, duotone, posterize, vignette, chromatic aberration, goo, chroma-key, backdrop-blur, and **mattes**

A narrow set is **GPU (Vello) only** — the CPU reference skips it or degrades:

- **Rotation** (`rotation` / `rotation3d`) — ignored
- **Clipping** (`clip`) — ignored; use a **`matte`** instead, which the CPU honors
- **Blend modes** (`blendMode`) — composite as Normal
- **Per-run rich text** and `letterSpacing` — drawn in the node's base style
- **3D** out-of-plane tilt and **`extrude`** — degrade to a flat 2.5D composite
- **light-wrap**, the cinematic **`finish` / `linear`** and **motion blur** — export/native only on *either* backend

## Which to use

| You want…                                          | Use            |
| -------------------------------------------------- | -------------- |
| Rotation, clipping, blend modes, true 3D / extrude | **`vello`** |
| Bit-identical, reproducible output across machines | **`cpu`** (bundled font) |
| A sensible default that picks the GPU when present | **`auto`** (the default) |

## The determinism caveat

The CPU backend is **bit-identical** across runs and machines when using the bundled default font — which is why it's the reference oracle and the right pick for reproducible pipelines. Passing `--system-fonts` uses the host's fonts and makes CPU output machine-dependent.

The GPU (Vello) backend is **not guaranteed bit-identical** across different GPUs and drivers. If you need reproducibility, render on the CPU; if you need rotation/clip/blend/3D or have a GPU, render with Vello.

:::caution[Backend-specific features]
**Rotation, `clip`, `blendMode`, out-of-plane 3D tilt and `extrude` are GPU-only** — on the CPU backend they're ignored or degrade to a flat composite. *Everything else* — fills, strokes, paths, gradients, rounded corners, anti-aliased text, images, and the full [effect chain](/guide/effects) — renders **identically** on both. The `auto` default picks the GPU whenever one is present.
:::
