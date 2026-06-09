# Engine Power vs After Effects — the keystone roadmap

_Captured 2026-06. Companion to `premium-engine-map.md` (the premium-look gap-map),
`render-to-texture.md` (the keystone subsystem most of this builds on), and
`gap-analysis.md` (the Remotion/perf framing). Where those ask "what makes a frame
feel premium," this asks the harder question the founder actually posed: **how
powerful is the ENGINE today vs After Effects, and what is the finite path to
AE-class power?** The agent complements the engine — this doc is strictly about the
renderer's capability ceiling, not direction/taste._

## The thesis

AE's "engine power" is **not a thousand effects** — it decomposes into a short list
of **architectural keystones**, and most AE features are leaves hanging off those
branches. ONDA today is a **strong, deterministic 2D compositor with premium
finishing** — roughly **50–65% of AE's engine surface for the mograph + AI-media
use case** — missing ~7 keystones, two of which are foundational and five of which
are incremental (several mostly authoring-layer).

**Reframe the goal.** Literal AE parity bundles a decade of work irrelevant to our
wedge: the NLE timeline UI, hundreds of legacy niche effects, the C++ plugin SDK.
The right target is **"AE-class for motion-graphics + AI-media compositing"** —
exactly the 7 keystones below — while leaning on the four things AE can *never*
match (determinism, headless GPU, built-in cinematic finishing, the agent). Don't
chase AE feature-for-feature; chase the keystones and protect the moat.

## Scorecard — ONDA vs AE today (our domain)

Rough judgment, mograph + AI-media compositing (not AE-as-NLE). Evidence in §Keystones.

| Domain | ONDA today | vs AE | Gap in one line |
|---|---|---|---|
| Procedural / "expressions" | React/JS authoring, seeded noise, springs | **~90% (wins)** | JS > AE expressions; no visual graph editor |
| Media (img / video / audio) | image, ffmpeg video, symphonia + FFT | **~75%** | Comparable/better; determinism is the edge |
| Animation / timing | keyframes, easings, springs, sequences | **~65%** | No time-remap, motion-path, hold keys, true motion blur |
| Compositing core | 16 blend modes, opacity, clip, **mattes**, groups | **~55%** | No precomp-object, adjustment layers, **3D**; 8-bit only |
| Color / finishing | grade, bloom+ACES, grain, halation, light-wrap | **~50% (a strength)** | Finishing *beats* stock AE; but no float pipeline, no curves/LUT |
| Vector / shapes | paths, gradients, dashed strokes, JS morph | **~50%** | No native trim-paths, booleans, repeater, path-morph |
| Typography | great vector text, per-glyph *layout* exposed | **~45%** | No per-glyph *animator* surface, text-on-path, variable fonts |
| Transforms / 3D | 2D translate/scale/rotate | **~30%** | No Z, camera, lights; CPU ref even drops rotation |
| Effect breadth | 7 effects, extensible shader-pass model | **~25% breadth** | No distortion, keying, curves, LUT, vignette, CA, DoF |

## The 7 keystones

Status: ✅ done · 🟡 partial · ❌ missing. Effort: S (days) / M (1–2 wk) / L
(weeks) / XL (foundational rewrite). Impact = how far it moves the *capability
ceiling*. "Foundational" = touches the whole renderer; "Incremental" = repeatable,
parallelizable, low architectural risk.

### K1 — Float / HDR pipeline · ❌ · XL · Impact: High (Foundational)

`Rgba16Float` render targets + linear-throughout compositing + a real ACES
finishing pass. **The single most foundational gap.** Today the engine finishes in
**8-bit gamma** (`Rgba8Unorm` hardcoded — `vello-rs/src/lib.rs:641`,
`renderer-rs/src/lib.rs:34`). sRGB↔linear functions exist
(`core-rs/src/color.rs:87–105`) but are *not* applied scene-wide; linear + ACES
runs **only inside the bloom composite**, gated behind `Composition::linear`
(`scene-rs/src/lib.rs:38`), GPU-only (`vello-rs/src/effects.rs:361`). AE's deepest
power *is* its 32-bit float linear pipeline: correct blends/blurs/grades,
banding-free gradients, and HDR headroom for the finishing wedge. Not a visible
single feature — a **multiplier on every effect**. Sequence anything photoreal
(and K2) *after* this, or you keep building on 8-bit sand.

### K2 — True 3D: flat layers + shared camera + lights · 🟡 (2.5D affine) · XL · Impact: Transformative

Biggest single *look*-multiplier; biggest lift. Transforms are **2D only**
(`core-rs/src/lib.rs:20–92`) — no Z, no perspective, no camera, no lights; the CPU
reference even *drops rotation*. This is AE's flat-3D-layer model (planes in space
under a shared camera), **not** mesh 3D. The RTT seam was explicitly designed to
feed it: render each layer → texture (have it) → a small wgpu 3D-compositing pass
places those planes with real perspective (`render-to-texture.md` Phase 5). Wants
K1's float pipeline underneath for correct lighting. True mesh 3D (`three-d`/`rend3`)
is a separate, later lift.

### K3 — Per-glyph / word / line text animators · 🟡 · M · Impact: High — **best ratio**

The core mograph capability, and closer than it looks. Per-glyph *layout* already
comes out of cosmic-text (`FontContext::layout` → positioned glyphs; the Vello
backend already draws per-glyph outlines). What's missing is the **authoring
driver**: AE-style range selectors (by character/word/line/index) → per-glyph
transform / opacity / color / stagger. The scene Text node carries only per-*run*
styling today (`scene-rs/src/lib.rs:491–517`). This is **mostly authoring-layer**
(one node per glyph, or a per-glyph animation driver) — low architectural risk,
high mograph value. Also unblocks **text-on-path** and per-line metrics (computed
internally but not exposed).

### K4 — Motion blur (per-layer shutter) · 🟡 (global supersample only) · L · Impact: High

The cinematic tell that separates "shot" from "slideshow." **Confirmed status:** a
CLI `--motion-blur K` flag does **temporal supersampling** (`cli-rs/src/main.rs:284–288,
883–897`) — the producer must emit K sub-frames per output frame, averaged into one
(`average_frame_groups`). It's a real 180° shutter, but **whole-frame, K× the
render cost, and the oversampling burden is on the author**. Missing: a **per-layer,
velocity-aware** shutter as a render primitive (sample a node's transform across the
shutter interval; blur only what moves, bounded per-node/per-scene). Cross-cutting
(animation + render). Cheaper after K1 (accumulation in float is correct).

### K5 — Effect breadth on the existing shader-pass model · 🟡 (7 effects) · M (S/effect) · Impact: Med–High

The architecture is **sound and repeatable** — adding a per-pixel or blur-based
effect is ~300–800 lines (WGSL + CPU reference + `Effect` enum variant), no
architectural blockers (`scene-rs/src/lib.rs:139–252`; `vello-rs/src/effects.rs`).
Today: Blur, Bloom, ColorGrade, Goo, Grain, BackdropBlur, LightWrap. **Volume work,
not rewrite work:** vignette, curves/levels, LUT/3D-LUT, directional & radial blur,
displacement/turbulence, chromatic aberration, basic chroma/luma keying + despill.
This is where the **agent can expand the library fast** and where the "any effect I
want" perception gap closes cheaply. Parallelizable. (DoF/bokeh wants depth → after
K2.)

### K6 — Native shape operators · 🟡 · M–L · Impact: Med–High

Mograph staples currently faked or absent. **Trim-paths** (S, high value): today
approximated via animated `dash_offset` (`scene-rs/src/lib.rs:1153–1158`) — a real
3-param start/end/offset trim is small and high-leverage. **Booleans** (union/sub/
intersect — deferred), **repeater** (duplicate + transform), **native path-morph**
(flubber works in JS today via `react/src/morph.ts`; native on `kurbo` would be
deterministic + reusable). Mostly geometry-track work, not RTT.

### K7 — Precomp-as-object + adjustment layers · ❌ · M · Impact: Med (workflow)

Groups already *are* implicit precomps (`NodeKind::Group`, `scene-rs/src/lib.rs:318–340`)
but there's no first-class "render this subtree, freeze it, reuse/solo it" object,
and **no adjustment layer** (an effect that applies to everything below it — effects
are per-node only today). Mostly a scene-model + authoring affordance; little new
rendering. Lower look-impact, real workflow-power.

## Ranking — effort × look-impact

```
 IMPACT
   ▲
 T │                                    K2 (3D)
   │
 H │   K3 (text anim) ── K5 (effects)        K4 (motion blur)   K1 (float)*
   │
 M │   K6 (shape ops)        K7 (precomp/adj)
   │
 L │
   └────────────────────────────────────────────────────────────────►  EFFORT
        S            M              L                    XL
   *K1 reads as "High" visible impact but is really a FOUNDATIONAL multiplier —
    its true value is unblocking correct K2 + serious finishing, not one look.
```

- **Cheap, do-first wins (high ratio):** K3 (per-glyph text), K5 (vignette / curves
  / directional blur first), and K6's **trim-paths** specifically.
- **Foundational, unavoidable:** K1 — do it before K2 and before any photoreal
  finishing push.
- **Biggest multipliers, heaviest lift:** K2 (3D) and K4 (motion blur) — last,
  after the float floor and the cheap wins prove out.

## The buildable plan (sequenced)

Each phase is a shippable vertical slice; each exposes the *next* phase's real
requirements rather than guessing them.

1. **K3 — per-glyph text animators.** Highest value-per-effort, mostly authoring;
   the layout data already exists. Ship range-selector → per-glyph transform/opacity/
   color/stagger + text-on-path. *Proves kinetic typography, a core mograph need.*
2. **K5 — effect breadth pass (round 1).** Vignette, curves/levels, LUT, directional
   + radial blur. Repeatable shader-pass pattern; parallelizable; agent-friendly.
   *Closes the "any effect" perception gap cheaply.*
3. **K6 — shape operators.** Native trim-paths first (S), then repeater + booleans +
   native path-morph. *Mograph staples; unblocks logo/icon motion.*
4. **K1 — float / HDR pipeline.** `Rgba16Float` targets + linear-throughout + ACES
   finish, behind an opt-in `Composition` flag (the bloom-linear path is the seed).
   *Foundational; makes all prior + future color math correct; required under K2.*
5. **K4 — per-layer shutter motion blur**, then **K2 — flat 3D layers + camera +
   lights.** The two biggest cinematic multipliers, sequenced last: K4 is cheaper in
   float (K1), and K2 wants both the float floor and the RTT seam (have it). Then
   **K7 — precomp/adjustment** as a workflow polish, and pour the rest into the
   agent-director.

After K1 + K2 land on top of the existing finishing stack, the engine clears
"AE-class for our domain"; everything past that is effect *volume* (K5 rounds 2–n)
and the agent.

## What ONDA already has that AE doesn't — protect this

AE-parity must not mean "a worse clone." The structural edge:

- **Determinism by construction** — byte-identical every run/machine; AE can't promise it.
- **Headless GPU render** — no Chromium, no UI tax (the benchmark story, `gap-analysis.md`).
- **Built-in cinematic finishing** — halation, light-wrap, deterministic film grain
  ship *native* (`vello-rs/src/effects.rs`); in AE these are plugins/comp tricks.
- **Frame-rate independence** — keyframes in seconds, portable across 24/30/60.
- **Programmatic React/JS authoring** — more expressive than AE expressions for procedural work.
- **The agent** — the actual moat (lives in Studio, not the engine).

## Cross-cutting debt (load-bearing for an agent + Studio flow)

- **The CPU reference lags the GPU path.** It drops rotation, clip, blend, and some
  effects (`renderer-rs` vs `vello-rs`). The golden oracle renders CPU-only — so the
  reference is currently *behind* the canonical output. As the engine grows, either
  bring the CPU path forward or formally designate Vello-native as the oracle.
- **"Preview lies."** The browser/WebGPU path degrades several effects (fBm, light-
  wrap, async effect-cache misses → "clear glass"). **The agent must judge look on
  native render, never live preview** — already a working-agreement principle; bake
  it into the Studio flow.
- **8-bit ceiling is the silent tax.** Until K1, every gradient/blur/grade quantizes
  to u8; film grain *masks* banding but doesn't fix the math. K1 is the fix.
