---
title: "@onda/react — Components"
---

All components and helpers are imported from `@onda/react`. Each component is a typed wrapper that emits a scene-graph node.

```tsx
import {
  Composition, Group, Rect, Ellipse, Path, Text, Image, Svg,
  linearGradient, radialGradient, clipRect, clipEllipse, clipPath, parseColor,
} from '@onda/react'
```

## Shared props

### `NodeProps`

Accepted by `<Group>`, `<Rect>`, `<Ellipse>`, `<Path>`, `<Text>`, `<Image>`, `<Svg>`.

| Prop               | Type        | Default | Notes                                         |
| ------------------ | ----------- | ------- | --------------------------------------------- |
| `id`               | `number`    | —       | Stable id; required to target the node from a timeline. |
| `x`, `y`           | `number`    | 0       | Translation in pixels.                        |
| `scaleX`, `scaleY` | `number`    | 1       | Scale factor.                                 |
| `rotation`         | `number`    | 0       | Clockwise degrees about the local origin (GPU backend). |
| `opacity`          | `number`    | 1       | 0..1.                                         |
| `clip`             | `ClipInput` | —       | Clip the node + subtree (local space).        |
| `children`         | `ReactNode` | —       | Child nodes.                                  |

### `PaintProps`

Accepted by the shape components `<Rect>`, `<Ellipse>`, `<Path>`.

| Prop          | Type            | Notes                                              |
| ------------- | --------------- | -------------------------------------------------- |
| `fill`        | `ColorInput`    | Solid fill.                                        |
| `gradient`    | `GradientInput` | Gradient fill — **takes precedence over `fill`**.  |
| `stroke`      | `ColorInput`    | Stroke color (GPU backend).                        |
| `strokeWidth` | `number`        | Stroke width (default 1 when `stroke` is set).     |

## Components

### `<Composition>`

The root of every tree. **Required** props: `width`, `height`, `fps`, `durationInFrames` (all `number`). Not a `NodeProps` — it carries the render's resolution and timing, not placement.

```tsx
<Composition width={1920} height={1080} fps={30} durationInFrames={90}>
  {/* nodes */}
</Composition>
```

### `<Group>`

`GroupProps = NodeProps`. A transform/opacity/clip container with no visual of its own.

### `<Flex>` / `<AbsoluteFill>`

Flex layout containers — position children relatively instead of by absolute `x`/`y`. `<Flex>` takes `direction` (`'row' | 'column'`), `justify` (`'start' | 'center' | 'end' | 'space-between' | 'space-around'`), `align` (`'start' | 'center' | 'end'`), `gap`, `padding`, and optional `width`/`height` (a fixed box distributes free space per `justify`; otherwise it shrink-wraps its content). `<AbsoluteFill>` fills the composition and lays out as a column by default — the idiomatic "center everything" / full-bleed container. Works on both backends and in the browser. See [Layout](/guide/layout).

```tsx
<AbsoluteFill justify="center" align="center">
  <Text fontSize={96}>Centered</Text>
</AbsoluteFill>
```

### `<Rect>`

`RectProps extends NodeProps, PaintProps`. Required: `width`, `height`. Optional: `cornerRadius?: number`.

```tsx
<Rect x={96} y={250} width={520} height={10} cornerRadius={5} fill="#2974f2" />
```

### `<Ellipse>`

`EllipseProps extends NodeProps, PaintProps`. Required: `width`, `height` (the bounding box the ellipse is inscribed in).

```tsx
<Ellipse x={470} y={150} width={120} height={120} fill="#22d3ee" />
```

### `<Path>`

`PathProps extends NodeProps, PaintProps`. Required: `d` (SVG path data, in local space). **Renders on the GPU (Vello) backend; the CPU backend skips paths.**

```tsx
<Path x={430} y={20} d="M50 0 L61 35 L98 35 L68 57 Z" fill="#fac81c" stroke="#806000" strokeWidth={2} />
```

### `<Text>`

`TextProps extends NodeProps`. Optional: `fontSize?: number` (engine default 48), `color?: ColorInput` (default white). The text is the element's children. Fonts: `fontFamily?`, `fontWeight?` (CSS 1..1000), `italic?`, and rich `runs?` for mixed inline styles; bundled families are **Open Sans** and **IBM Plex Sans**. See [Typography](/guide/typography).

```tsx
<Text x={96} y={110} fontSize={96} color="#ffffff" fontFamily="IBM Plex Sans" fontWeight={700}>Hello ONDA</Text>
```

### `<Image>`

`ImageProps extends NodeProps`. Required: `src: string` — a file path (resolved relative to the scene JSON's directory) or a base64 `data:` URI. The image is decoded (PNG/JPEG/GIF/WebP) and drawn on **both backends**, scaled by the node's transform; `data:` URIs work in the browser too.

```tsx
<Image x={40} y={40} src="logo.png" scaleX={1.5} scaleY={1.5} />
```

### `<Svg>`

`SvgProps extends NodeProps`. One of `src?: string` (file path/URL, resolved relative to the scene JSON's directory at render time) or `markup?: string` (inline; wins when both are present). Expanded into vector nodes by `onda-svg`; renders on the GPU backend. See [SVG import](/guide/svg).

```tsx
<Svg x={40} y={30} markup={inlineSvgString} />
<Svg x={240} y={30} src="badge.svg" />
```

## Color

`type ColorInput = string | { r: number; g: number; b: number; a?: number }`

Hex strings accept `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. Object components are in 0..1.

```ts
import { parseColor } from '@onda/react'
parseColor('#3b82f6')          // { r: 0.231..., g: 0.510..., b: 0.964... }
parseColor({ r: 1, g: 0, b: 0, a: 0.5 })
```

## Gradients

```ts
linearGradient(start: Point, end: Point, stops: GradientStopInput[]): GradientInput
radialGradient(center: Point, radius: number, stops: GradientStopInput[]): GradientInput
```

`Point` is `[x, y]` or `{ x, y }`. `GradientStopInput` is `{ offset: number; color: ColorInput }` with `offset` in 0..1. Coordinates are in the shape's **local space**. A gradient takes precedence over a solid `fill`. On the CPU backend a gradient falls back to its first stop's color.

```tsx
gradient={linearGradient([0, 0], [360, 0], [
  { offset: 0, color: '#2974f2' },
  { offset: 1, color: '#f25a8c' },
])}

gradient={radialGradient([60, 60], 60, [
  { offset: 0, color: '#66ccff' },
  { offset: 1, color: { r: 0.4, g: 0.8, b: 1, a: 0 } },
])}
```

## Clips

```ts
clipRect(width: number, height: number, cornerRadius?: number): ClipInput
clipEllipse(width: number, height: number): ClipInput
clipPath(d: string): ClipInput
```

Pass the result to a node's `clip` prop. **GPU-backend feature** (ignored by the CPU backend).

```tsx
<Group clip={clipRect(150, 50, 12)}>{/* clipped subtree */}</Group>
```
