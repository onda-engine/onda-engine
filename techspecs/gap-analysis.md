# ONDA — Gap Analysis: the road to 100× better than Remotion

This maps where ONDA stands today against (a) the founding brief's Performance
Goals + Benchmarking System, and (b) Remotion + the Rust rendering state of the
art. It is grounded in two research passes (Remotion architecture/feature audit;
Rust GPU/typography/animation/media SOTA) and in measured benchmarks.

## 1. What "100× better than Remotion" actually means

The 100× is **architectural, not a single number**. Remotion is
`React → DOM → headless Chromium → screenshot per frame → encode`. Its per-frame
cost is dominated by the browser: style/layout/paint, a screenshot over the
DevTools protocol, IPC, and per-page memory (hundreds of MB/worker). ONDA is
`React → scene graph → native renderer → frame`, with no browser anywhere.

### Measured today (Apple M4 Pro, 1920×1080, 120 frames)

| Backend                            |    fps | ms/frame |
| ---------------------------------- | -----: | -------: |
| Remotion (Chromium, 1 worker)      |   26.8 |    37.34 |
| Remotion (Chromium, default pool)  |   76.1 |    13.14 |
| ONDA — CPU (1 thread)              |  119.5 |     8.37 |
| ONDA — CPU (all cores, rayon)      |  709.7 |     1.41 |
| ONDA — GPU (offscreen + readback)  |  377.1 |     2.65 |

This is a *trivial* scene (a title + a few shapes) — Remotion's best case. The
honest read:

- **~4.5× per-thread** (ONDA CPU 1-thread vs Remotion 1-worker) and **~9.3×
  machine-throughput** (all cores each, default settings) — already, on the easy
  case. Remotion's ~37 ms/frame/worker is mostly fixed browser overhead
  independent of content; ONDA's scales with what's actually drawn. ONDA's rayon
  scaling (~6×) also beats Remotion's (~3×): its per-worker browser tax makes
  concurrency sublinear.
- **The gap widens toward 100× with**: (1) scene complexity — a complex DOM
  balloons Remotion's layout/paint/screenshot while ONDA grows gently; (2) the
  **GPU path** (real-time present, not the readback-bound number above); (3)
  **cold start** — ONDA pays ~ms (font load) vs Chromium launch + bundle +
  "warmup frames" (seconds), which dominates short/serverless renders; (4)
  **memory** — one process + shared GPU buffers vs a full browser per worker,
  so far higher concurrency per machine → fewer machines → lower $/video.
- **Structural wins Remotion can't patch**: GPU-first rendering (headless Chrome
  *disables* the GPU by default), native video/audio (Remotion's most fragile
  subsystem), and **determinism by construction** (no time-API patching, no
  compositor "warmup", identical output every run/machine).

So: lead with the measured per-thread multiple and the trajectory; claim 100× as
the realized ceiling on real workloads (complex scenes × GPU × parallel × cold
start), not as a trivial-scene headline.

## 2. Current state (built)

`core` (Vec2/Size/Color/Transform — translate+scale only; linear-space color) ·
`scene` (Group/Text/Image[not drawn]/Shape[rect,ellipse,**path**], **gradient**
fills, **clip** regions) · CPU `renderer` (rects+ellipses, text via cosmic-text
coverage, src-over; no AA, no strokes/paths/gradients/clips — the reference
oracle) · **`vello`** (GPU-native vector backend: AA fills+strokes, rounded rects,
arbitrary paths, linear/radial gradients, clip masks, **native per-glyph vector
text**; offscreen+readback; single wgpu — the quad+SDF `gpu` crate is retired) ·
`typography` (cosmic-text+swash, bundled Open Sans; coverage masks **and**
per-glyph `layout`) · **`svg`** (`usvg` → flattened `Path` nodes) · `animation`
(keyframes + easings + springs on opacity/translate/scale) · `cli` (render/export/
export-frames → png/gif/mp4) · `@onda-engine/react` (reconciler, useCurrentFrame/
interpolate/spring, `<Sequence>`/`<Series>`/`<Loop>`, renderFrames) · `wasm` (CPU
engine in browser).

## 3. Gaps, prioritized

P0 = needed for a credible, fast, correct v1. P1 = parity/quality. P2 = later.

### A. Performance & scaling (the headline metric)
- **✅ DONE Parallel offline rendering** — `onda_renderer::render_frames_parallel`
  (`rayon`, one renderer/worker; behind the `parallel` feature so wasm still
  builds). Wired into the CLI `export`/`export-frames`. Measured ~6× scaling →
  709 fps (above), already exceeding Remotion's sublinear pool.
- **P0 Readback/present pipeline** — today: per-frame target-texture alloc +
  blocking `poll(Wait)` readback. Fix: reuse targets, a **ring of async-mapped
  readback buffers** (render N+1 while N maps), and a **swapchain present path**
  for the preview (never read back). Overlap encode with render (Remotion's 3.0
  trick, ~10–15%).
- **P0 Glyph atlas** — `glyphon`/`etagere` shelf-packed atlas with LRU; stop
  re-uploading a coverage texture per text block per frame, and batch glyph draws.
- **P1 Resource pooling** — reuse GPU textures/buffers; arena per-frame scene
  clones (`evaluate_at` clones the whole scene each frame).
- **P2 Incremental/dirty rendering** — diff scene between frames, cache static
  layers; big win for talking-head / lower-third content.
- **P1 Request compute-capable device** — current `Features::empty()` +
  `downlevel_defaults` blocks the Vello compute path (see B).

### B. Vector / GPU rendering quality
- **✅ DONE — Vello vector engine (migration complete).** `onda-vello`
  (`VelloRenderer::render(&Scene)`) is now ONDA's GPU-native vector backend,
  rendering the scene graph headlessly on Metal with: AA fills + **strokes**,
  **real rounded rects**, arbitrary **Bézier paths** (`ShapeGeometry::Path`),
  **native per-glyph vector text** (Vello glyph runs via `FontContext::layout` —
  resolution-independent, per-glyph-animatable), **linear & radial gradients**
  (`Shape::gradient`), and **clip regions** (`Node.clip`, any geometry as a mask).
  The hand-rolled quad+SDF `onda-gpu` crate is **retired/deleted**, so the GPU
  stack is consolidated on a single wgpu (22.1.0, via Vello). SVG import lands via
  the new **`onda-svg`** crate (`usvg` → flattened `Path` nodes). Remaining polish
  (not blockers): map SVG gradients/patterns (currently solid-only), glyph atlas
  for text batching (A), and the readback→present pipeline (A). Vello Hybrid /
  tiny-skia stay as portability fallbacks.
- **P1 Blur/filters/blend modes** — separable Gaussian compute + Porter-Duff;
  frontier even for Vello.
- **P1 Group opacity as a real layer** — composite masked/translucent groups to
  an offscreen layer (today each node draws directly).
- **P1 Strokes & rounded-corner rasterization** in the CPU path too (currently
  fills only; `corner_radius` ignored).

### C. Typography (cosmic-text already supports most — we just don't expose it)
- **✅ DONE Per-glyph layout exposure** — `FontContext::layout` returns positioned
  glyphs (`GlyphPosition { id, x, y }`), and the Vello backend draws them as
  native outlines via glyph runs. This is the foundation for **kinetic typography**
  (per-glyph animation) and **text-on-path**; the remaining work is the *authoring*
  surface (one node per glyph, or a per-glyph animation driver).
- **P1 Variable-font axes** (`wght`/`wdth`/`opsz`, animatable), **OpenType
  features** (ligatures/kerning/stylistic sets/`tnum`), **rich multi-run styled
  text** (cosmic-text `AttrsList`).
- **P1 Color/emoji glyphs** (COLR/CPAL, sbix, CBDT) — swash decodes them; needs a
  color-carrying glyph raster (RGBA, not R8 coverage). Today emoji → silhouette.
- **P1 Deterministic ordered fallback chain** — bundle a fixed-priority font set
  (CJK/emoji/symbols) so coverage improves without losing reproducibility.
- **P2 Text-on-path** (needs B + per-glyph exposure).

### D. Animation
- **✅ DONE Linear-space color interpolation** — `onda_core::Color::{to_linear,
  from_linear}` (sRGB transfer fns); `Lerp for Color` now interpolates in linear
  light (alpha direct). The renderers can adopt the same for correct compositing.
- **✅ DONE Springs** (mass/stiffness/damping) — `onda_animation::spring` +
  `@onda-engine/react` `spring()`, frame-keyed/deterministic (semi-implicit Euler),
  overshoot for underdamped configs.
- **✅ DONE Sequences/Series/Loop** — `@onda-engine/react` `<Sequence from durationInFrames>`,
  `<Series>`/`<Series.Sequence>` (back-to-back), `<Loop>` (frame-context shifting,
  Remotion-style). Still TODO: `<Freeze>`, and a declarative (Rust-side) equivalent.
- **✅ DONE More easings** — `CubicBezier{x1,y1,x2,y2}` (Rust + TS `cubicBezier()`)
  + Back in/out/inout. Still TODO: elastic/bounce, and **more animatable
  properties** (rotation/skew/anchor/color/numeric; path morphing once B exists).
- **P2 Noise** (Perlin/simplex `wiggle()`), **state machines** (Rive-style;
  `rive-rs` runs on Vello).

### E. Media (audio / video / encode)
- **P1 Audio** — `symphonia` decode + `rodio` mix + `cpal` preview; muxing. No
  audio = no real videos.
- **P1 Video decode** (`<Video>` equivalent) — `ffmpeg-next` (broadest) or
  `dav1d`/VideoToolbox. Remotion's most fragile subsystem → ONDA's easy win.
- **P1 Hardware encode** — `ff-encode` (VideoToolbox/NVENC/QSV + SW fallback);
  feed GPU frames straight to the encoder instead of PNG→ffmpeg round-trips.
- **P2 AV1** (`rav1e`/`svt-av1`), **audio-reactive** (`rustfft` → animation
  inputs — a differentiator).

### F. DX & feature parity with Remotion (the moat — and the risk)
The research is blunt: **speed is the easy structural win; the moat is DX
parity.** Highest-risk parity items, in order:
1. **Authoring model** — keep real React/JSX over the Rust engine (we have the
   reconciler) vs a native API. Abandoning React is the biggest adoption risk.
2. **Layout/styling** — Remotion gets all of CSS/flexbox free. ONDA must decide:
   reimplement a layout system (e.g. `taffy` flexbox) or offer a native model.
   **The single biggest API-surface gap.**
3. **Studio** (timeline + props editor + live preview + render button + hot
   reload) and the **embeddable Player** (we have a basic player; needs WebGPU +
   real-time present per A/B).

Concrete must-haves for a "Remotion replacement" v1: `<Sequence>`/`<Series>`,
spring(), `<Audio>`/`<Video>`/`<Img>`/`<Gif>`, Google-Fonts-class font loading,
transitions, **still** + **parametrized/data-driven** render (typed props + Zod-
style validation), a programmatic render API + CLI (have basics), Studio + Player,
TypeScript types, npm-trivial install. Nice-to-have: Lottie, three/skia, captions
(Whisper), distributed/cloud render (ONDA's per-node speed reduces the need).

## 4. Recommended P0 sequence

1. ✅ **`rayon` parallel frame rendering** — DONE (~6× → 709 fps; ~9.3× Remotion
   at the machine level).
2. **Readback ring + reuse targets + swapchain present** — ends the blocking
   stall; unlocks real-time preview (and the WebGPU player).
3. **Glyph atlas (glyphon)** — text perf + draw batching.
4. ✅ **Adopt Vello as the vector backend** — DONE. Paths, strokes, AA, gradients,
   clips, SVG import (`onda-svg`), and native per-glyph vector text all landed;
   quad+SDF `onda-gpu` retired and wgpu consolidated to one version.
5. ✅ **Linear-space color lerp + per-glyph text exposure** — DONE
   (`Color::{to,from}_linear`; `FontContext::layout`). The kinetic-typography
   *authoring* surface (per-glyph nodes/driver) is the remaining follow-up.

Strategic insight from the research: **#4 and per-glyph typography are coupled** —
moving to Vello fixes the vector gap *and* enables per-character animation and
text-on-path, exactly where a motion-graphics engine must out-class Remotion's
DOM/SVG approach. And every perf item compounds the already-measured 4–13× toward
the 100× ceiling on real workloads.
