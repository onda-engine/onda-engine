---
title: "Animation"
---

`@onda-engine/react` provides two ways to drive values from the frame: `interpolate` (map a frame through input/output ranges) and `spring` (natural, physics-based motion). Both are pure functions, so renders are reproducible.

## `interpolate`

Maps `input` from `inputRange` to `outputRange`. Mirrors Remotion's API.

```ts
function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options?: InterpolateOptions,
): number

interface InterpolateOptions {
  easing?: EasingFn
  extrapolateLeft?: 'clamp' | 'extend'   // default 'clamp'
  extrapolateRight?: 'clamp' | 'extend'  // default 'clamp'
}
```

- `inputRange` and `outputRange` must be the **same length (≥ 2)** and ascending — otherwise it throws.
- Out-of-range inputs **clamp** by default; pass `'extend'` to extrapolate.

```tsx
const opacity = interpolate(frame, [0, 30], [0, 1])                 // fade in over 30 frames
const x = interpolate(frame, [0, 15, 30], [0, 100, 0])              // multi-segment
const y = interpolate(frame, [0, 15], [150, 110], { easing: Easing.easeOutCubic })
```

## `Easing`

Built-in easing presets (any `(t: number) => number` works too). These match `onda-animation`'s curves.

```ts
const Easing: {
  linear, easeInQuad, easeOutQuad, easeInOutQuad,
  easeInCubic, easeOutCubic, easeInOutCubic,
  smoothStep, easeInBack, easeOutBack,
}

type EasingFn = (t: number) => number
```

```tsx
interpolate(frame, [0, 20], [0, 1], { easing: Easing.easeInOutCubic })
```

## `cubicBezier`

A CSS-style cubic-Bézier ease with control points `(x1,y1)`, `(x2,y2)` and fixed endpoints `(0,0)`–`(1,1)`. Returns an `EasingFn`. Matches `onda-animation`'s `CubicBezier`.

```ts
function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn
```

```tsx
const ease = cubicBezier(0.25, 0.1, 0.25, 1) // "ease"
const v = interpolate(frame, [0, 30], [0, 1], { easing: ease })
```

## `spring`

A deterministic, frame-keyed spring (a damped harmonic oscillator pulled from 0 toward 1, integrated at a fixed `1/fps` step). A pure function of `frame`, so renders are reproducible. Underdamped configs overshoot.

```ts
interface SpringConfig {
  mass?: number       // default 1
  stiffness?: number  // default 100
  damping?: number    // default 10
}

interface SpringOptions {
  frame: number       // e.g. from useCurrentFrame()
  fps: number         // composition frame rate
  from?: number       // default 0
  to?: number         // default 1
  config?: SpringConfig
}

function spring(options: SpringOptions): number
```

```tsx
import { spring, useCurrentFrame, useVideoConfig } from 'onda-engine/react'

function Pop() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const scale = spring({ frame, fps, config: { stiffness: 120, damping: 12 } })
  return <Rect scaleX={scale} scaleY={scale} width={100} height={100} fill="#3b82f6" />
}
```

Pass `from` / `to` to settle between arbitrary values:

```tsx
const y = spring({ frame, fps, from: 200, to: 0 }) // slide up into place
```

## `random`

`random(seed: number | string): number` — a deterministic value in `[0, 1)`. Compositions must render identically every time (same frame → same pixels), so reach for this instead of `Math.random()`.

```ts
import { random } from 'onda-engine/react'
const jitter = random(`dot-${i}`) * 10 - 5 // stable per i, every render
```

## `noise2D` / `noise3D`

Smooth, coherent value noise in `[-1, 1]` — seeded and deterministic — for organic motion (drift, wobble, jitter). Scale the inputs to set the frequency; animate a coordinate over `frame` for movement.

```ts
import { noise2D } from 'onda-engine/react'
const y = baseY + noise2D('drift', frame * 0.05, 0) * 20
```

## Notes

- The `interpolate` easings and `spring` integration **mirror the Rust `onda-animation` runtime**, so React-authored motion and a Rust-side timeline produce matching curves.
- These drive **opacity, translate, scale, and rotation** (rotation is honored by the GPU backend). Skew, color, and path morphing aren't available yet.
