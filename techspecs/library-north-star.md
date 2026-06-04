# ONDA Library — North Star ("out of this world" videos)

_Strategic ceiling for the @onda library + engine. Captured 2026-06 from a
founder conversation. The goal: let an AI agent (ONDA Studio) produce videos at
the level of a 30-year studio motion-graphics professional — the kind previously
made only in After Effects with expert help._

## The reframe — ONDA bottles the pro; it doesn't clone AE

A 30-year AE pro's value is **taste** (timing, easing, anticipation, restraint,
layout, color), not the software. The ONDA bet: **encode that taste into the
components**, so a non-expert / an agent gets pro judgment for free. The "out of
this world" magic = great components (encoded craft) + the **agent as director**.

For the ~90% of professional output that is *compositional* — explainers, ads,
brand films, product launches, data stories, music pieces, intros/outros, UI
showcases — ONDA can hit "a pro made this in AE." Those videos are patterns
composed with rhythm, not bespoke hero shots.

## The bigger unlock — AI image + video generation

Studio will have **image generation and video generation**. That changes the
thesis: **ONDA does NOT need to generate photoreal content — the AI models do.**
ONDA becomes the **world-class compositor + motion layer + director ON TOP of
AI-generated media:**

> AI-generated cinematic footage/stills + ONDA's pro motion-graphics craft
> (titles, lower-thirds, kinetic type, data, transitions, brand, grading) + the
> agent directing both generation AND composition = a video neither could make
> alone.

ONDA supplies exactly what AI video is worst at: **directed, frame-perfect,
on-brand motion-graphics polish and pacing.** This reprioritizes the library
away from "generate effects" toward "**land AI media beautifully**."

## 3D — on the curve, NOT a non-goal (earlier framing was too conservative)

Vello is a **2D vector renderer on wgpu — affine transforms only** (no
perspective, no meshes). So 3D is tiered:

1. **2.5D (affine) — available NOW.** Parallax, isometric/oblique, scale-by-depth.
2. **AE-style 3D LAYERS (flat planes in 3D, real perspective + camera) —
   reachable.** Render each 2D layer/composition **to a texture** (Vello can),
   then a small **wgpu 3D-compositing pass** places those textures as planes in
   3D space with a shared camera, and composites. This is *exactly* AE's 3D-layer
   model (flat planes, not meshes): card flips, cube reveals, camera fly-throughs,
   3D panels. Clean because **it's all wgpu**.
3. **True mesh 3D (glTF models, extruded type, lighting) —** a full wgpu 3D
   pipeline; biggest lift. Use an OSS Rust-on-wgpu renderer (**`three-d`**,
   `rend3`, `bevy`'s render), composited with Vello — don't hand-roll.

**KEY ARCHITECTURAL INSIGHT:** the deferred **render-to-texture subsystem**
(originally scoped for content/text blur) is the SAME foundation that unlocks
**3D layers** (render layer → texture → place as a plane in 3D). **One subsystem,
two of the biggest premium levers (blur + 3D).** Build it deliberately.

**Remotion contrast:** Remotion isn't 2D — it's "the browser," and via
`@remotion/three` (react-three-fiber + three.js) it gets **true WebGL 3D for
free**. ONDA's no-Chromium architecture trades that away (3D isn't free → build
it natively on wgpu) for determinism + speed + headless scale.

## Library roadmap, by payoff (compositor-over-AI-media focused)

1. **Render-to-texture subsystem** → content/text blur **+ 3D layers** (two birds).
2. **Glow / bloom** — the single biggest "premium" tell.
3. **Mattes / animated masks** — reveal media through type/shapes (the #1 pro move).
4. **Color grading / LUT / gradient-map** — unify mismatched AI clips into one look
   (critical when assets come from different generations).
5. **2.5D → 3D camera** — parallax/camera over AI stills + AI-video panels in 3D.
   **3D × AI-gen multiply** here — the top-tier cinematic look, trivial cost.
6. **Compositing-over-media polish** — Ken Burns ✓ / parallax ✓ + callouts/titles
   over footage; **beat-synced cutting** (audio FFT ✓ → beat detection).
7. **Particle system** (general, beyond Confetti), **displacement/turbulence/
   liquify**, **shape morphing / path interpolation**, **light sweeps / lens
   flares**, **kinetic-type ceiling** (text-on-path, per-glyph rotation, masked
   reveals).

**Above components:** curated **scene/sequence templates** (a pro brings *rhythm*)
and **motion "vibes"** (pick `cinematic` / `energetic` / `corporate-calm` /
`playful` → timing, easing, transitions shift *coherently*).

## The real unlock is the AGENT-DIRECTOR

Components can be world-class and still yield amateur videos without direction.
The "wow" is the agent as a 30-year director: it **sees** its output (vision
stack: structural lint → annotated contact-sheet → zoom) and self-corrects; it
**owns pacing** (scene rhythm, holds, beat-sync); it **writes the gen prompts**
and **composites/grades**. The library makes it *possible*; the agent makes it
*art*. After the library is "rich enough," **pour the energy into the agent.**
