---
title: "Hooks"
---

`@onda-engine/react` components are pure functions of the current frame. These hooks give a component access to the frame and the composition's config. They must be called inside a `<Composition>` that is being rendered by one of the [render functions](/api/render) — otherwise they throw.

## `useCurrentFrame()`

Returns the frame currently being rendered (0-based).

```ts
function useCurrentFrame(): number
```

```tsx
import { Text, interpolate, useCurrentFrame } from '@onda-engine/react'

function FadeIn() {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 15], [0, 1])
  return <Text opacity={opacity} fontSize={96} color="#fff">Hello</Text>
}
```

The frame is supplied per render. When wrapped in a [`<Sequence>` / `<Loop>`](/api/timeline), the value the hook returns is **shifted** by that container — that's how time-shifting works.

## `useVideoConfig()`

Returns the composition's resolution and timing.

```ts
interface VideoConfig {
  width: number
  height: number
  fps: number
  durationInFrames: number
}

function useVideoConfig(): VideoConfig
```

```tsx
import { useCurrentFrame, useVideoConfig, spring } from '@onda-engine/react'

function Pop() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const scale = spring({ frame, fps })
  return <Rect scaleX={scale} scaleY={scale} width={100} height={100} fill="#3b82f6" />
}
```

`fps` is the natural input to [`spring`](/api/animation#spring), and `width` / `height` are handy for centering content.

## Errors

Both hooks throw if called outside a rendered `<Composition>`:

```txt
useCurrentFrame must be called inside a <Composition> rendered by renderFrame/renderFrames
```

This happens if you call them in a component that isn't part of a tree passed to `renderFrame` / `renderFrames` / `renderToScene` / `renderFramesJSON`.
