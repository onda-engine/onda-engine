# Premium Engine Map — what the ENGINE needs for Apple/Linear/ElevenLabs-tier comps

_Tactical gap-map, captured 2026-06, AFTER the render-to-texture (RTT) keystone
shipped. Companion to `library-north-star.md` (the strategic ceiling) and
`render-to-texture.md` (the subsystem most of this builds on). Purpose: before we
"prove the ceiling" (hand-author one reference-tier film), enumerate the **engine
primitives** that separate our current output from Apple keynote / Linear /
ElevenLabs polish — and mark what's a true renderer gap vs. what's composable in
the library/Studio layer on top of primitives we already have._

## The floor we already poured ✅

The engine can already render most of what makes a frame feel _shot_:

- **RTT effect chain** on `Node.effects` — `Blur` (depth of field), `Bloom` (the
  #1 premium tell), `ColorGrade` (exposure/contrast/sat/temp/tint), `Goo` (liquid
  morph). Both backends; deterministic; async pre-pass for the browser.
- **Vector core** — `Shape` with linear + radial **gradients**, stroke, and a
  blurred **drop-shadow/glow** (`Shadow`, CSS box-shadow incl. spread).
- **Compositing** — per-node `opacity`, `clip` (Vello), `blend` (CSS
  mix-blend-mode, Vello), affine `transform`, flex `layout` (taffy).
- **Media** — `Image`, `Video` (decoded pre-pass), `Audio` on the timeline;
  **audio FFT** spectrum (real, browser+native identical).
- **Library** — 70 premium-tuned components incl. KineticText, FilmGrade,
  Vignette, GrainOverlay, Confetti, the audio visualizer; theme system.

That's blur, bloom, grade, gooey, gradients, glow, blend, media, audio — a lot.
What's left is a short, specific list.

## What's missing — the engine gaps

Status: ✅ done · 🟡 partial · ❌ missing. Effort: S/M/L. "Engine" = a true
renderer primitive (must live in the Rust core); "Composable" = buildable in the
component/Studio layer from primitives we already have.

### Tier 1 — completes the signature premium TECHNIQUE set (build on RTT)

1. **Frosted / backdrop glass** — ❌ Engine · M · _Linear panels, Apple/visionOS
   material, ElevenLabs cards._ The existing `Blur` blurs a node's OWN subtree;
   frosted glass blurs **what's behind** a panel (the already-composited
   backdrop) and tints it. Needs a backdrop-capture seam (sample the target under
   the node before drawing it). Reuses the blur kernel. The single highest
   wow-per-effort move and the dominant 2025-26 design language.

2. **Masks / mattes (luma + alpha)** — ❌ Engine · M–L · _Apple keynote
   text-over-footage; the **#1 pro move**._ Use one subtree's alpha (or
   luminance) to reveal another — **footage playing inside animated letterforms**,
   shape wipes, gradient reveals. The literal embodiment of the wedge (the
   compositor that _lands_ AI media). RTT capture seam already exists; needs a
   mask field + a masked-composite pass.

3. **Motion blur** — ❌ Engine · L · _the cinematic tell that separates "shot"
   from "slideshow."_ Sub-frame sampling (shutter angle) so fast moves smear
   instead of strobing. Every Apple product move has it. Hardest of Tier 1 but
   transformative; can scope to a per-node/per-scene shutter to bound cost.

### Tier 2 — the 3D dimension (biggest single look-multiplier, bigger lift)

4. **3D layers (flat planes in 3D + shared camera)** — 🟡 (2.5D affine now) ·
   Engine · L · _Apple card-flips, panel parallax, camera fly-throughs._ Render
   each layer → texture (RTT, have it) → a small **wgpu 3D-compositing pass**
   places those textures as planes with real perspective + a shared camera. This
   is AE's 3D-layer model (planes, not meshes). The north-star's key insight: same
   RTT foundation as blur/mattes. (True mesh 3D via `three-d`/`rend3` is a later,
   separate lift.)

### Tier 3 — generative surface + finishing (texture, life, light)

5. **Animated mesh-gradient / noise / aurora backdrops** — ❌ Engine (shader) · M
   · _the Linear/Stripe living-gradient backdrop, ElevenLabs ambient field._
   Procedural shader pass; static gradients (✅) don't breathe.
6. **Displacement / turbulence / liquify** — ❌ Engine (shader) · M · organic
   distortion (heat, smoke, ink, dissolve transitions); a new effect pass.
7. **Light sweeps / specular glint / lens flare** — 🟡 Composable once **mattes**
   land · S–M · the glint across glass/metal/a logo (gradient + blend + animated
   mask).
8. **General particle system** — 🟡 Composable / Engine for scale · M · embers,
   dust, bokeh, sparks, sceneside snow — beyond the single Confetti component.

### Tier 4 — motion-craft primitives

9. **Path morphing / SVG path interpolation** — 🟡 Composable (have `Shape`
   paths) · M · logo-A → logo-B, icon transitions.
10. **Text-on-path + per-glyph depth** — 🟡 Composable (KineticText foundation) ·
    S–M · the kinetic-type ceiling.
11. **Beat detection** — 🟡 Composable (FFT ✅) · S · FFT → onset/beat for
    beat-synced cutting; the agent's rhythm hook.

## The honest read

- **Engine primitives that are true renderer work:** frosted glass, mattes,
  motion blur, 3D layers, and a few shader passes (mesh-gradient/noise,
  displacement). Everything else (light sweeps, particles, morphing, text-on-path,
  beat-sync) is **composable** on top of what we already have.
- **The two that most define the look** and aren't composable: **mattes**
  (media-through-type) and **frosted glass**. They're also the cheapest of the
  true-engine gaps (both reuse RTT + the blur kernel). Strongest next build.
- **3D layers** is the biggest single multiplier but the biggest lift — sequence
  it after the cheap signature wins prove out.
- **Necessary but NOT engine:** the look is _necessary_ via primitives but only
  _sufficient_ via **direction** — pacing, restraint, beat-sync, one-idea-per-
  scene. That's the agent-director (Studio moat), per north-star §"the real unlock
  is the AGENT-DIRECTOR". Primitives make Apple-tier _possible_; the agent makes
  it _happen_.

## Suggested sequence (then prove the ceiling)

1. **Frosted glass** (Tier 1.1) — cheap, reuses blur, instant premium material.
2. **Mattes** (Tier 1.2) — the signature pro move + the AI-compositor wedge.
3. **Prove the ceiling** — hand-author ONE Apple/Linear/ElevenLabs-tier film with
   {glass + mattes + bloom + grade + 2.5D}. The gaps it exposes (motion blur? 3D?
   a missing shader?) become the _measured_ Tier-2/3 roadmap — not guesses.
4. Then **motion blur** and/or **3D layers** per what the reference demanded, and
   pour the rest into the **agent-director**.
