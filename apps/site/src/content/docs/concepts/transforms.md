---
title: "Transforms, opacity & clip"
---

Every node — `group`, shapes, text, image, svg — shares the same placement model: a transform, an opacity, and an optional clip region. These are what compose down the tree.

## Coordinate convention

Pixel space, **origin top-left, +x right, +y down**. A shape's geometry is authored in its own local space (origin at the shape's top-left); the node's composed transform places it on the canvas.

## Transform

ONDA's transform is **translate, scale, and rotate** (`rotate` in degrees, clockwise about the node's local origin). Skew is a deliberate follow-up. Rotation is honored by the GPU (Vello) backend — including nested rotation, composed as affine matrices down the tree; the CPU reference rasterizer applies translate + scale only.

```json
{ "translate": { "x": 96, "y": 110 }, "scale": { "x": 1, "y": 1 }, "rotate": 30 }
```

In React, set it with the `rotation` prop (degrees), and animate it like anything else: `rotation={interpolate(frame, [0, 90], [0, 360])}`.

- `translate` defaults to `(0, 0)`.
- `scale` defaults to `(1, 1)` (identity).

In React these are the `x` / `y` and `scaleX` / `scaleY` props:

```tsx
<Text x={96} y={110} scaleX={1.2} scaleY={1.2} fontSize={96} color="#fff">
  Hello
</Text>
```

Only the props you set appear in the JSON: setting any of `x`/`y` emits a `translate`; setting any of `scaleX`/`scaleY` emits a `scale`.

## Opacity

A node's `opacity` is in `0.0..=1.0` and defaults to `1.0`. It composes down the subtree — a `group` at `opacity={0.5}` fades everything inside it together.

```tsx
<Group opacity={0.5}>
  <Rect width={100} height={40} fill="#3b82f6" />
  <Text fontSize={24} color="#fff">faded</Text>
</Group>
```

On the Rust side, opacity is clamped into range.

## Clip

A node can carry a **clip** geometry: when set, the node and its entire subtree are clipped to that shape, in the node's local space. The clip geometry is the same `ShapeGeometry` used by shapes — a rect (optionally rounded), an ellipse, or an arbitrary path.

```tsx
import { clipRect } from '@onda-engine/react'

<Group x={40} y={120} clip={clipRect(150, 50, 12)}>
  <Text x={6} y={-8} fontSize={72} color="#3ce69a">CLIP</Text>
</Group>
```

The clip helpers build the geometry:

- `clipRect(width, height, cornerRadius?)`
- `clipEllipse(width, height)`
- `clipPath(d)` — SVG path data

In JSON, `clip` is a `ShapeGeometry` on the node:

```json
{
  "clip": { "shape": "rect", "size": { "width": 150, "height": 50 }, "corner_radius": 12 },
  "kind": { "type": "group" },
  "children": [ /* ... */ ]
}
```

:::caution[Backend support]
**Clip is a GPU (Vello) feature.** The CPU reference backend ignores it. Likewise, rounded corners on a clip rect only take effect on the GPU backend. See [Backends](/guide/backends).
:::

## How it composes

The renderer walks the tree, composing each node's transform and opacity with its ancestors', and intersecting clips down the subtree. Nodes don't store their resolved/world values — only their local transform/opacity/clip — keeping the scene graph a clean, declarative description that any renderer can interpret consistently.
