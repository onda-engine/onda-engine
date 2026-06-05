# Cinematic AI-media layer — engine plan

**Goal:** make ONDA the *director/compositor over AI/real media* — land a footage/
image plate inside a deterministic motion-graphics comp so it "looks shot," not
pasted-on. (Audit + VFX-finishing research → prioritized gap plan, 2026-06-05.)

## The verdict (the foundational finding)

**ONDA does ALL finishing math in gamma (sRGB) space, not linear light.** Effect
textures are hardcoded `Rgba8Unorm` (not `Rgba8UnormSrgb`); Bloom clamps to 1.0
(no HDR headroom). The correct sRGB↔linear transfer fns EXIST in
`core-rs/src/color.rs` but are wired only into `animation-rs` color tweening —
the renderer never linearizes. So bloom/blur/grade/glass mix light in gamma →
darkened edges, flat glows, "overlay" bloom. The engine is *display-referred*,
not *scene-linear*. Light-wrap, halation, true DoF/bokeh, chromatic aberration:
absent. Render-to-texture + background-capture seams DO exist (blur/bloom/grade/
goo/matte are real compute passes w/ CPU mirrors; AlphaMatte proves the two-input
pattern) — good substrate to build on.

## KEYSTONE (the FBM-equivalent first build): linear + HDR working space + tone-map

Re-host the existing chain in scene-linear with HDR headroom + a film output
transform. **It's a re-host, not a new effect — but everything built on top is
wrong without it.**
- Switch render-to-texture + every `effects.rs` target to **`Rgba16Float`**.
- **Decode sRGB→linear on ingest** (image draw, capture path, FBM) using the
  existing `core-rs` transfer fns.
- Re-host blur/bloom/grade/goo/matte math in linear; **drop the two Bloom 1.0
  clamps** (allow >1.0 highlights → real light bleed).
- Add a final **ACES tone-map + linear→sRGB encode** pass (modeled on the
  color-grade shader) as the LAST step.
- Mirror in `renderer-rs` (CPU) in lockstep; **re-baseline goldens**.
- **GATE it** behind an opt-in (e.g. a `Composition` color-pipeline flag, default
  sRGB) so existing comps (incl. the shipped FBM hero) are untouched and cinematic
  comps opt in. Feature-detect `Rgba16Float`; fall back to gamma if unsupported.

## Prioritized gaps (after the keystone)

1. **[critical] Light-wrap** — the biggest "looks shot" tell. Matted media keeps
   razor edges; nothing bleeds background light onto fg edges. New `LightWrap`
   Effect + `effects.rs` pass: reuse `build_backdrop_texture` + the AlphaMatte
   two-input pattern + GaussianBlur; rim mask = blurred-fg-alpha − core; additive
   composite in linear. `lightWrap` NodeProps sugar + CPU mirror.
2. **[high/small] Halation** — film bleeds a red/orange halo around highlights.
   A Bloom variant: higher threshold, red/orange halo tint, add back in linear.
3. **[high] Lift/gamma/gain (ASC-CDL slope/offset/power)** in linear — black-point
   matching + a true teal-orange split-tone (FilmGrade currently fakes it).
4. **[medium] Native grain (+ vignette) as a final post-pass** — frame-seeded
   noise over the composited frame near the output transform, so grain is
   luminance-aware + chain-ordered (today they're TS overlays on top).
5. **[medium/large] Depth-aware defocus + bokeh** — disc kernel driven by Camera
   2.5D depth + CoC; needs a filterable sampler; bright bokeh blooms in linear.
   Last (per-plane Gaussian covers the cheap 80%).
6. **[low/small] Chromatic aberration** — single-pass radial RGB offset.

## Exemplar (proves the ceiling)

6–8s vertical 1080×1920 title card from ONE CC0 golden-hour portrait composited as
a directed shot: corrective grade (sat ~0.85, contrast ~0.95) to kill the stock
tell; slow Camera push; focus-pull (animated blur sigma hi→0 on a defocused bg
duplicate, subject stays sharp); FilmGrade teal-orange; Bloom now reading as real
light bleed in linear; the **title matted through the portrait** + a kinetic
lower-third; vignette; ONE shared grain over everything; tone-mapped + motion-
blurred MP4. The **gamma-vs-linear bloom before/after proves the keystone.**

## Asset

One CC0 high-res JPEG (Unsplash/Pexels, commercial-ok, no attribution): golden-hour
editorial portrait, dark softly-lit background, shallow DoF, negative space for a
title. An `Image` node decodes JPEG with per-image blur on both backends. A still
sidesteps the gated video path + gen-video flicker. (Engine HAS an `<Image>`
already — `width/height/fit/blur` + inherits grade/bloom/matte via NodeProps; this
initiative enriches it into a finishing-ready *plate*.)

## Parallel thread (user-flagged): morphing + camera continuity

Apple/ElevenLabs lean hard on MORPHING. Today only a scene-transition `morph()`
exists — true element/path morph (magic-move) does NOT. Needs `morphPath(from,to,t)`
JS helper in `@onda/react` (path-correspondence interp, not naïve d-lerp) — ~zero
engine change. Camera continuity already exists (the `Camera` primitive). Fold
both into the cinematic exemplar (media + morphs under one continuous camera).

## Risks

- **Backend lockstep**: native Vello + WebGPU preview + CPU mirror must move to
  linear + tone-map identically or goldens drift — budget re-baselining.
- **`Rgba16Float` portability** on wgpu/Dawn/wasm32 — feature-detect/fallback.
- Vello composites in its own non-linear space → need a consistent
  linear-at-capture-boundary story for gradients/blends.
- The tone-map **shifts existing comps (incl. the FBM hero)** → gate behind a flag /
  version the look.
- Light-wrap/halation/CA need subtle defaults, **judged from the exported MP4**,
  not the live preview.
- 8-bit-in-linear bands hard in shadows → the `Rgba16Float` intermediate is
  non-negotiable.
