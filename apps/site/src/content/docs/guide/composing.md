---
title: Composing — the complete reference
description: Everything an agent or author needs to write a correct ONDA composition in one page.
---

This page is the single source of truth for writing `.comp.mjs` composition files
with `@onda/react`. Read it before authoring; it covers the full node surface,
effects, animation, timeline, camera, component shortcuts, and the footguns that
cause silent bugs or crashes.

## The full node surface

Every visual primitive (`Group`, `Rect`, `Ellipse`, `Path`, `Text`, `Image`,
`Video`, `Svg`) accepts `NodeProps`:

| Prop | Type | Notes |
|---|---|---|
| `x`, `y` | `number` | Translate in px. |
| `scaleX`, `scaleY` | `number` | Scale factor (1 = identity). |
| `rotation` | `number` | Clockwise degrees. **Vello/GPU backend only** — CPU ignores it. |
| `originX`, `originY` | `number` | Pivot for scale + rotation, in px (default 0,0 = top-left). |
| `opacity` | `number` | 0..1. |
| `clip` | `ClipInput` | Clip the node + its subtree. `clipRect(w,h,r?)`, `clipEllipse(w,h)`, `clipPath(d)`. GPU only. |
| `matte` | `ReactElement` | Reveal this node through another subtree's alpha/luminance — masks, shape wipes, gradient reveals. |
| `matteMode` | `'alpha' \| 'luminance'` | Default `'alpha'`. |
| `blendMode` | `string` | CSS blend mode (GPU backend). |
| `blur` | `number` | Gaussian blur σ in px — render-to-texture. Both backends. |
| `directionalBlur` | `object` | `{ sigma, angle }` — 1D motion-blur smear along `angle` (radians); reads as in-motion. Both backends. |
| `backdropBlur` | `number` | Frosted-glass blur of what is **behind** this node. GPU only. |
| `bloom` | `object` | `{ threshold?, intensity?, radius? }` — bright regions bloom outward. GPU only. |
| `grade` | `object` | `{ brightness?, contrast?, saturation?, temperature?, tint? }` — color grade (CSS-style, 1 = identity). |
| `grain` | `number \| object` | Film grain. `0.04`–`0.1` is filmic. Object form: `{ intensity, size?, seed? }`. |
| `goo` | `object` | `{ sigma, threshold? }` — metaball/goo blend between sibling shapes. GPU only. |
| `lightWrap` | `object` | `{ sigma, strength?, backdropNode? }` — bleeds backdrop light onto the node's feathered edges. GPU/export only. |
| `shadow` | `object` | `{ color, blur, offsetX?, offsetY?, spread? }` — drop shadow behind the node. |
| `chromaticAberration` | `number` | Lens RGB split — amount in px, red/blue channels shifted radially from centre. Both backends. |
| `vignette` | `number \| object` | `{ amount, softness? }` — radial edge darkening; number is shorthand for `amount`. Both backends. |
| `posterize` | `number` | Quantize each channel to N levels (cel / screen-print look). Both backends. |
| `duotone` | `object` | `{ shadow, highlight }` — map luminance onto two colors (Spotify-poster look). Both backends. |
| `chromaKey` | `object` | `{ color, threshold?, smoothness? }` — knock out a key color (green screen) to transparent. Both backends. |
| `effects` | `Effect[]` | Raw effects array — prefer the sugar props above. |

### Cinematic finish (`<Composition finish={…}>`)

A composition-level **finishing chain** run after the comp rasterizes, in scene-linear
light with HDR headroom, ending in **one ACES film tone-map** — the "looks shot" output
transform. Unlike per-node effects (which Vello hands back 8-bit between passes, so HDR
is lost), the finish keeps everything in float to a single tone-map, so bloom highlights
bleed *real* light and roll off filmically. **GPU/export only** (the CPU reference and a
WebGPU-less browser render un-finished — judge it on the native/export render). Every
field defaults to a no-op, so `finish={{ bloom: { sigma: 16 } }}` is just bloom + ACES.

```tsx
<Composition width={1920} height={1080} fps={30} durationInFrames={120}
  finish={{
    bloom: { sigma: 18, threshold: 0.2, intensity: 2.4 }, // linear-HDR glow
    halation: 0.7,        // warm red/orange fringe around highlights
    temperature: 0.22,    // grade: + warm / − cool
    contrast: 1.12,       // grade: contrast around mid-grey (1 = identity)
    saturation: 1.08,     // grade: 1 = identity, 0 = greyscale
    vignette: 0.42,       // radial edge darkening
    grain: 0.05,          // luminance-banded film grain (frame = seed, automatic)
    exposure: 1.0,        // linear exposure before the tone-map
  }}>
  {/* … */}
</Composition>
```

Chain order: bloom + halation → exposure → grade → vignette → grain → ACES.

### Motion blur (`<Composition motionBlur={…}>`)

Shutter-angle **per-object motion blur** via temporal supersampling: each output frame
is the average of `samples` sub-frames spread across the shutter window, so anything
that **moves** smears by its own motion (translation, rotation, scale — anything that's
a function of the frame) while static elements stay sharp. **Export-only** — cost is
`samples`× the render, so the live preview shows the sharp frame.

```tsx
// `true` = a 180° shutter at 16 samples; or tune both:
<Composition motionBlur={{ shutter: 180, samples: 16 }} …>
```

`shutter` is in degrees (180 = half the frame, the film default; 360 = full-frame,
heavier). More `samples` = a smoother smear at linear cost.

### Depth of field (`<Composition dof={…}>` + `depth`)

A **2.5D rack focus**: give each layer a `depth` (any units) and the comp a
`dof={{ focus }}`, and every layer defocuses by how far its `depth` is from the focus
plane — sharp at `focus`, blurrier away from it. Animate `focus` for a focus pull
between layers. It resolves to a **per-layer blur** (reuses the blur pass), so it
works on both backends and the live preview — no true 3D, the depth is yours to assign.

```tsx
<Composition dof={{ focus: 400, aperture: 0.06, range: 28 }}>
  <Group depth={900}><Background /></Group>   {/* far  → blurred */}
  <Group depth={400}><Subject /></Group>      {/* at focus → sharp */}
  <Group depth={120}><Foreground /></Group>   {/* near → blurred */}
</Composition>
```

`aperture` = blur px per unit of depth past the in-focus band (bigger = shallower DoF);
`range` = a sharp band ± `focus`; `maxBlur` clamps the σ (default 40).

### Shape operators (mograph)

Operations on the path/geometry itself, the AE-shape-layer vocabulary:

- **Trim paths** — `trimStart` / `trimEnd` / `trimOffset` (fractions 0..1) on any
  **stroked** shape draw only that arc-length slice of the outline. Animate `trimEnd`
  0→1 for a line-draw (logos, underlines, signatures, loaders). The engine measures
  the path length, so you never touch pixel lengths; identical on GPU + CPU.

  ```tsx
  <Ellipse stroke="#e85494" strokeWidth={14} strokeCap="round"
    trimEnd={interpolate(frame, [0, 40], [0, 1], { extrapolateRight: 'clamp' })} />
  ```

- **`<Repeater>`** — stamp a subtree `count` times, each copy COMPOUNDING one more step
  of the transform (offset / rotation / scale) + a step of the opacity ramp: grids,
  radial arrays, spirals, motion trails. Nest two for a 2D grid. Pure composition —
  renders the same on every backend, live and exported.

  ```tsx
  <Repeater count={12} rotation={30} originX={180} originY={180}>
    <Rect width={24} height={70} cornerRadius={12} fill="#e85494" />
  </Repeater>
  ```

  Props: `count`, `offsetX`, `offsetY`, `rotation` (deg/copy), `scale` (factor/copy),
  `originX`/`originY` (pivot), `startOpacity`/`endOpacity` (ramp).

- **`<Merge op="…">`** — boolean "merge paths": combine the SHAPE children into ONE
  outline. `op` is `union` (add), `difference` (the first minus the rest), `intersect`
  (common area), or `xor` (symmetric difference). A ring = circle − circle; a lens =
  circle ∩ circle; a speech bubble = rect ∪ triangle. The children fold into the
  result (not drawn separately) — fill/stroke the `<Merge>` itself. Both backends.

  ```tsx
  <Merge op="difference" fill="#5ad1ff">
    <Ellipse width={130} height={130} />
    <Ellipse x={70} width={120} height={120} />
  </Merge>
  ```

### Particles (`<Particles>`)

A **deterministic** particle emitter — bursts, fountains, confetti, sparks, dust,
snow. Every particle's whole state (spawn, velocity, age, size, opacity, colour,
spin) is a PURE function of `frame + seed + index`, so it scrubs and exports
deterministically (no `Math.random`). Frame-based units (velocity = px/frame,
gravity = px/frame²); each live particle is a plain shape — position/size/opacity/colour
are identical on CPU + GPU, while `spin` (rotation) is GPU-only.

```tsx
<Particles
  count={170} seed={11} x={W / 2} y={190}
  speed={5} speedVariance={0.55}   // launch speed (px/frame) + random reduction
  angle={-90} spread={360}         // direction (deg; −90 = up) + cone (360 = omni)
  gravity={0.08}                   // downward accel (px/frame²)
  lifetime={70} emitOver={0} loop={false}   // life (frames); stagger; re-emit for a fountain
  shape="square" size={[13, 6]} opacity={[1, 0.55]} spin={420}
  colors={['#e85494', '#ffd36b', '#5ad1ff', '#27b78d']}
  spawnRadius={0}                  // spawn within this radius of the origin
/>
```

### Colors

`ColorInput` is a hex string (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) or `{ r, g, b, a? }` (0..1 channels). `'none'` and `'transparent'` are accepted and treated as fully transparent. **Never pass a bare string that isn't a hex color** — it will throw.

### Clips

```ts
import { clipRect, clipEllipse, clipPath } from '@onda/react'
<Group clip={clipRect(300, 100, 12)}> … </Group>
```

Clip regions are in the **node's local space**. GPU only — the CPU backend ignores them.

---

## Animation

```ts
import { spring, interpolate, Easing, useCurrentFrame, useVideoConfig } from '@onda/react'
```

### `useCurrentFrame()`

Returns the current frame number (0-based). The only way to read time inside a component.

### `spring()`

Physics spring from `from` → `to`. Returns a single number.

```ts
spring({
  frame,         // current frame, shifted to 0 at the spring's start
  fps,           // frames per second
  from?: number, // start value (default 0)
  to?: number,   // end value (default 1)
  config?: {
    damping?: number,   // higher = less bounce (200 = overdamped, no bounce)
    stiffness?: number, // higher = faster spring (100 = moderate)
    mass?: number,      // higher = slower (default 1)
  },
  durationInFrames?: number, // cap duration for a deterministic settle
})
```

**Useful presets:**

```ts
const SPRING_SMOOTH = { damping: 200, stiffness: 100, mass: 1 }  // overdamped, slides in
const SPRING_SNAPPY = { damping: 120, stiffness: 180, mass: 1 }  // decisive, no bounce
const SPRING_POP    = { damping:  14, stiffness: 100, mass: 1 }  // underdamped, bounces
```

### `interpolate()`

Map an input range to an output range, with optional easing.

```ts
interpolate(frame, [0, 30], [0, 1], {
  easing: Easing.easeOutCubic,
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
})
```

---

## Timeline

```ts
import { Sequence, Loop, Series, TransitionSeries } from '@onda/react'
```

### `<Sequence from={N} durationInFrames={D}>`

Shifts children in time — inside, `useCurrentFrame()` returns `outerFrame - N`.
Children only render while `0 ≤ localFrame < durationInFrames`.

```tsx
// Title appears at frame 30, lasts 60 frames.
<Sequence from={30} durationInFrames={60}>
  <Title />   {/* sees frame 0..59 */}
</Sequence>
```

### `<Loop durationInFrames={D}>`

Children see `frame % D` — repeats forever for as long as the composition runs.

### `<Series>`

Sequences auto-stacked — no need to calculate cumulative offsets. Each
`<Series.Sequence durationInFrames={D}>` starts exactly when the previous one ends.

```tsx
<Series>
  <Series.Sequence durationInFrames={60}><Intro /></Series.Sequence>
  <Series.Sequence durationInFrames={90}><Main /></Series.Sequence>
  <Series.Sequence durationInFrames={30}><Outro /></Series.Sequence>
</Series>
```

### `<TransitionSeries>`

Like `<Series>` but with animated transitions between segments.

```tsx
import { TransitionSeries, crossFade, springTiming } from '@onda/react'

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={60}>
    <SceneA />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition timing={springTiming({ damping: 200 })}>
    {crossFade()}
  </TransitionSeries.Transition>
  <TransitionSeries.Sequence durationInFrames={90}>
    <SceneB />
  </TransitionSeries.Sequence>
</TransitionSeries>
```

**Available transitions:** `crossFade`, `fade`, `slide`, `push`, `flip`, `iris`,
`blur`, `glassWipe`, `clockWipe`, `gridPixelate`, `depthPush`, `devicePullback`,
`expandMorph`, `dipToColor`, `morph`, `chromaticAberration`, `none`.

---

## Camera

`<Camera>` is a world-space pan/zoom viewport. Children inside it are rendered in
**world coordinates**; the Camera translates and scales so that `focusX/focusY`
lands at the canvas center, scaled by `zoom`.

```tsx
import { Camera } from '@onda/react'

<Camera focusX={960} focusY={540} zoom={1.5} rotate={0}>
  {/* world-space content */}
</Camera>
```

| Prop | Type | Notes |
|---|---|---|
| `focusX`, `focusY` | `number` | World point that maps to the canvas center. |
| `zoom` | `number` | 1 = identity; >1 zooms in; animate for a dolly. |
| `rotate` | `number` | Degrees (GPU/Vello only). |

Animate `zoom` or `focusX/focusY` with `spring()` for smooth camera moves.

---

## `@onda/components` — ready-made animation primitives

Import from `@onda/components`. These wrap `Group` + `spring`/`interpolate` in
one line so you don't hand-code enter/exit math.

### Entry animations

| Component | What it does |
|---|---|
| `<FadeIn delay? durationInFrames?>` | Opacity 0 → 1 on the house spring. |
| `<ScaleIn from? delay? durationInFrames?>` | Scale `from` → 1 (default 0.9), centered. |
| `<SlideIn direction? distance? delay?>` | Translates in from off-screen. |
| `<RotateIn degrees? delay?>` | Rotates from `degrees` → 0. |
| `<TrackingIn delay?>` | Letter-spacing collapses in (kinetic text reveal). |

### Exit animations

`<FadeOut>`, `<SlideOut>`, `<ExitScale>` — mirrors of the entry set.

### Stagger

`<StaggerGroup staggerFrames? children>` — applies increasing delays to each child.

### Text

| Component | What it does |
|---|---|
| `<Typewriter text speed? startFrame?>` | Characters appear one by one. |
| `<KineticText preset? text>` | Word/glyph reveal presets (`'fade-up'`, `'slide-left'`, `'scale-in'`). |
| `<WordStagger text staggerFrames?>` | Staggers each word of a string. |

### Motion vocabulary (pure functions, no JSX needed)

```ts
import { entryScale, entryFade, entryFadeRise, entrySlide, exitFade, stateSwap } from '@onda/components'

const { opacity, scaleX, scaleY } = entryScale({ frame, fps, delay, durationInFrames, from })
```

Returns plain numbers; apply them as props directly.

### Other useful components

`<DrawOn>` (path stroke-on), `<MaskReveal>`, `<GradientShift>`, `<KenBurns>`,
`<CountUp>`, `<ProgressBar>`, `<Terminal>`, `<InputField>`, `<IconPop shape="check|star|dot|cross">`.

---

## Iteration workflow (fast feedback loop)

The render script has three modes. Use the fastest one for the task:

```bash
# Check one frame — fastest (~5s). Great for layout/color/spring-settle checks.
node apps/site/scripts/render-comp.mjs --comp my.comp.mjs \
  --fps 30 --duration 1470 --backend vello --no-build \
  --frame 300
# → /tmp/onda-frame-300.png

# Check a scene window — fast (~15-60s). Render just the frames you're editing.
# Produces a standalone short clip from those frames.
node apps/site/scripts/render-comp.mjs --comp my.comp.mjs \
  --fps 30 --duration 1470 --backend vello --no-build \
  --frames 240:360 --out /tmp/scene-log.mp4

# Full render — use only for final delivery or cross-scene checks.
node apps/site/scripts/render-comp.mjs --comp my.comp.mjs \
  --fps 30 --duration 1470 --backend vello --no-build \
  --out /tmp/full.mp4
```

**Agent iteration loop:** edit comp → `--frame N` (5s) → if layout is right, `--frames start:end` (scene clip, ~30s) → if scene is right, full render only for final check.

---

## Composition file template

```js
import { createElement as h } from 'react'
import {
  Composition, Group, Rect, Ellipse, Path, Text, Image,
  Camera, Sequence, spring, interpolate, useCurrentFrame,
} from '@onda/react'

const FPS = 30
const W = 1280, H = 720
const T = (s) => Math.round(s * FPS)

export default function myComp({ fps, durationInFrames, width, height }) {
  return h(Composition, { width, height, fps, durationInFrames },
    h(Scene, null),
  )
}

function Scene() {
  const frame = useCurrentFrame()
  const pop = spring({ frame, fps: FPS, durationInFrames: 20 })
  return h(Group, { opacity: pop },
    h(Rect, { x: 0, y: 0, width: W, height: H, fill: '#111' }),
    h(Text, { x: 80, y: 200, fontSize: 80, color: '#fff' }, 'Hello'),
  )
}
```

---

## Known footguns

These cause silent misrenders or hard crashes. Memorize them.

### `fill: 'none'` → use `'#00000000'`

~~`fill="none"`~~ used to crash with a parse error. It now maps to transparent, but prefer `'#00000000'` for clarity.

### `&&` children in `Group` → use a ternary

```ts
// WRONG — if cond is false, Group receives false as a child
h(Group, null, cond && h(Rect, ...))

// RIGHT — ternary with a zero-size placeholder
h(Group, null, cond
  ? h(Rect, ...)
  : h(Rect, { width: 0, height: 0, fill: '#00000000' }))
```

### Pre-computed element variables → always inline

```ts
// WRONG — closures can capture stale reconciler state
const card = h(NodeCard, props)
h(Group, null, card)

// RIGHT — inline the call
h(Group, null, h(NodeCard, props))
```

### Components must not return `null` → use `opacity: 0`

```ts
// WRONG — ONDA's reconciler treats null as an unexpected empty node
if (frame < startF) return null

// RIGHT — render with opacity 0 (or a zero-size placeholder Rect)
return h(Group, { opacity: frame < startF ? 0 : 1 }, ...)
```

### `rotation` is GPU only

`rotation` renders correctly on Vello/export. The CPU backend (`--backend cpu`) ignores it. Do not rely on rotation for final verification using the CPU reference renderer — always check on Vello.

### `blur`, `backdropBlur`, `grain`, `bloom`, `lightWrap` are GPU/export only

These render-to-texture effects produce nothing on the CPU backend. Verify them with `--backend vello`, never `cpu`.

### `clip` is GPU only

`clip` (and `matte`) are Vello-only — the CPU backend skips them silently.
