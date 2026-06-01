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

`core` (Vec2/Size/Color/Transform — translate+scale only) · `scene` (Group/Text/
Image[not drawn]/Shape[rect,ellipse]) · CPU `renderer` (rects+ellipses, text via
cosmic-text coverage, src-over; no AA on rects, no strokes, no image decode) ·
`gpu` (wgpu: instanced quads + SDF-AA ellipses + text-coverage textures;
offscreen+readback) · `typography` (cosmic-text+swash, bundled Open Sans, only
content/size/color exposed) · `animation` (keyframes + 8 easings on opacity/
translate/scale) · `cli` (render/export/export-frames → png/gif/mp4) · `@onda/
react` (reconciler, useCurrentFrame/interpolate, renderFrames) · `@onda/player`
(Canvas2D preview + WASM engine) · `wasm` (CPU engine in browser).

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
- **P0 A real path/vector engine** — quad+SDF only does rects/ellipses. Adopt
  **Vello** (GPU compute, sparse-strip AA) — or **Vello Hybrid** for portability;
  **tiny-skia** CPU fallback. Unlocks arbitrary filled **paths/Béziers**,
  **strokes** (caps/joins/dashes), analytic **AA on everything**, **gradients**
  (interpolated in linear light), **clips/masks**, and **SVG** (via `usvg`). This
  one move also enables per-glyph vector text and text-on-path (couples with C).
- **P1 Blur/filters/blend modes** — separable Gaussian compute + Porter-Duff;
  frontier even for Vello.
- **P1 Group opacity as a real layer** — composite masked/translucent groups to
  an offscreen layer (today each node draws directly).
- **P1 Strokes & rounded-corner rasterization** in the CPU path too (currently
  fills only; `corner_radius` ignored).

### C. Typography (cosmic-text already supports most — we just don't expose it)
- **P0 Per-glyph layout exposure** — surface cosmic-text `LayoutGlyph` so each
  glyph is an animatable node → **kinetic typography** (the motion-graphics killer
  feature; impossible today since text is one opaque mask).
- **P1 Variable-font axes** (`wght`/`wdth`/`opsz`, animatable), **OpenType
  features** (ligatures/kerning/stylistic sets/`tnum`), **rich multi-run styled
  text** (cosmic-text `AttrsList`).
- **P1 Color/emoji glyphs** (COLR/CPAL, sbix, CBDT) — swash decodes them; needs a
  color-carrying glyph raster (RGBA, not R8 coverage). Today emoji → silhouette.
- **P1 Deterministic ordered fallback chain** — bundle a fixed-priority font set
  (CJK/emoji/symbols) so coverage improves without losing reproducibility.
- **P2 Text-on-path** (needs B + per-glyph exposure).

### D. Animation
- **P0 Linear-space color interpolation** — `Lerp for Color` blends raw sRGB →
  muddy mid-tones (a real bug). Convert to linear/OkLab, lerp, convert back.
- **P1 Springs** (mass/stiffness/damping) — the modern "feel"; keep
  **frame-keyed** (analytic/semi-implicit, not wall-clock) for determinism.
- **P1 Sequences/Series/Loop/Freeze** — composable time-shifting (Remotion
  staple); today a flat `Vec<Animation>` with no nesting/offset/loop.
- **P1 More easings** (CSS cubic-bézier, back/elastic/bounce) and **more
  animatable properties** (rotation/skew/anchor/color/numeric; path morphing once
  B exists).
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
4. **Adopt Vello as the vector backend** (retire quad+SDF) — paths, strokes, AA,
   gradients, clips, SVG, and per-glyph vector text in one move (needs a
   compute-capable device).
5. **Linear-space color lerp + per-glyph text exposure** — small, high-leverage
   correctness + the kinetic-typography unlock.

Strategic insight from the research: **#4 and per-glyph typography are coupled** —
moving to Vello fixes the vector gap *and* enables per-character animation and
text-on-path, exactly where a motion-graphics engine must out-class Remotion's
DOM/SVG approach. And every perf item compounds the already-measured 4–13× toward
the 100× ceiling on real workloads.
