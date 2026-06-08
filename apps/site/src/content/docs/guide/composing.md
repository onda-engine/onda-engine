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
| `backdropBlur` | `number` | Frosted-glass blur of what is **behind** this node. GPU only. |
| `bloom` | `object` | `{ threshold?, intensity?, radius? }` — bright regions bloom outward. GPU only. |
| `grade` | `object` | `{ brightness?, contrast?, saturation?, temperature?, tint? }` — color grade (CSS-style, 1 = identity). |
| `grain` | `number \| object` | Film grain. `0.04`–`0.1` is filmic. Object form: `{ intensity, size?, seed? }`. |
| `goo` | `object` | `{ sigma, threshold? }` — metaball/goo blend between sibling shapes. GPU only. |
| `lightWrap` | `object` | `{ sigma, strength?, backdropNode? }` — bleeds backdrop light onto the node's feathered edges. GPU/export only. |
| `shadow` | `object` | `{ color, blur, offsetX?, offsetY?, spread? }` — drop shadow behind the node. |
| `effects` | `Effect[]` | Raw effects array — prefer the sugar props above. |

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
