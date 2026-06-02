---
title: "Scene-graph JSON"
---

The scene graph is plain JSON. This is the exact representation the Rust engine (`onda-scene`) deserializes, and the format `@onda/react` emits. You can hand-write it, generate it from an AI, or produce it from React — it all renders the same way.

Field names are **snake_case**; enums are **internally tagged** (a discriminant field like `"type"`, `"shape"`, or `"gradient"`).

## Top level: `Scene`

```ts
interface Scene {
  composition: Composition
  root: SceneNode
}
```

```json
{
  "composition": { "width": 1280, "height": 720, "fps": 60, "duration_in_frames": 120 },
  "root": { "kind": { "type": "group" }, "children": [ /* ... */ ] }
}
```

## `Composition`

```ts
interface Composition {
  width: number
  height: number
  fps: number
  duration_in_frames: number
}
```

## `SceneNode`

```ts
interface SceneNode {
  id?: number            // omit if not animation-targeted
  transform?: Transform  // omit for identity
  opacity?: number       // default 1.0
  clip?: ShapeGeometry   // omit for none (GPU backend)
  kind: NodeKind
  children?: SceneNode[] // omit if empty
}
```

Omitted fields fall back to defaults on the Rust side (`opacity` → 1.0, etc.).

## `Transform`

```ts
interface Transform {
  translate?: Vec2  // default { x: 0, y: 0 }
  scale?: Vec2      // default { x: 1, y: 1 }
}

interface Vec2 { x: number; y: number }
```

## `NodeKind`

A tagged union on `type`:

```ts
type NodeKind =
  | { type: 'group' }
  | { type: 'text'; content: string; font_size?: number; color?: Color }
  | { type: 'image'; src: string }
  | { type: 'shape'; geometry: ShapeGeometry; fill?: Color; gradient?: Gradient; stroke?: Stroke }
  | { type: 'svg'; src?: string; markup?: string }
```

Defaults: `text.font_size` → 48, `text.color` → white. `shape.gradient` takes precedence over `shape.fill`.

## `ShapeGeometry`

A tagged union on `shape` (also used for `clip`):

```ts
type ShapeGeometry =
  | { shape: 'rect'; size: Size; corner_radius?: number }  // corner_radius default 0
  | { shape: 'ellipse'; size: Size }
  | { shape: 'path'; data: string }                        // SVG path data, local space

interface Size { width: number; height: number }
```

## `Color`

Straight-alpha sRGB, components in 0..1. `a` defaults to 1.

```ts
interface Color { r: number; g: number; b: number; a?: number }
```

## `Gradient`

A tagged union on `gradient`. Points are in the shape's **local space**; stop `offset`s are 0..1.

```ts
type Gradient =
  | { gradient: 'linear'; start: Vec2; end: Vec2; stops: GradientStop[] }
  | { gradient: 'radial'; center: Vec2; radius: number; stops: GradientStop[] }

interface GradientStop { offset: number; color: Color }
```

## `Stroke`

```ts
interface Stroke { color: Color; width: number }
```

## A complete example

```json
{
  "composition": { "width": 640, "height": 280, "fps": 30, "duration_in_frames": 1 },
  "root": {
    "kind": { "type": "group" },
    "children": [
      {
        "kind": {
          "type": "shape",
          "geometry": { "shape": "rect", "size": { "width": 640, "height": 280 } },
          "fill": { "r": 0.04, "g": 0.05, "b": 0.09 }
        }
      },
      {
        "transform": { "translate": { "x": 40, "y": 210 } },
        "kind": {
          "type": "shape",
          "geometry": { "shape": "rect", "size": { "width": 360, "height": 12 }, "corner_radius": 6 },
          "gradient": {
            "gradient": "linear",
            "start": { "x": 0, "y": 0 },
            "end": { "x": 360, "y": 0 },
            "stops": [
              { "offset": 0, "color": { "r": 0.16, "g": 0.45, "b": 0.95 } },
              { "offset": 1, "color": { "r": 0.95, "g": 0.35, "b": 0.55 } }
            ]
          }
        }
      },
      {
        "transform": { "translate": { "x": 40, "y": 60 } },
        "kind": { "type": "text", "content": "Scene graph", "font_size": 56, "color": { "r": 1, "g": 1, "b": 1 } }
      }
    ]
  }
}
```

Render it:

```bash
cargo run -p onda-cli -- render scene.json out.png
```

:::tip[Animated documents]
`onda export` takes a different shape — `{ "scene": ..., "timeline": ... }` — where `timeline.animations` are keyframe tracks targeting node `id`s. `onda export-frames` takes a JSON **array** of `Scene`s (one per frame), which is what `renderFramesJSON` emits. See the [CLI reference](/api/cli).
:::
