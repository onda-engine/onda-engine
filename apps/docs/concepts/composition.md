# Composition & nodes

## Composition

A `Composition` is the resolution and timing of a render — modeled on Remotion's `<Composition>`. Every scene has exactly one, at the top of the document.

```json
{ "width": 1920, "height": 1080, "fps": 30, "duration_in_frames": 90 }
```

| Field               | Type  | Meaning                          |
| ------------------- | ----- | -------------------------------- |
| `width`             | `u32` | Canvas width in pixels.          |
| `height`            | `u32` | Canvas height in pixels.         |
| `fps`               | `f32` | Frames per second.               |
| `duration_in_frames`| `u32` | Length of the render, in frames. |

The duration in **seconds** is `duration_in_frames / fps`. In React you set these as props on `<Composition>` (`durationInFrames` becomes `duration_in_frames` in the JSON).

## The node tree

Below the composition is a tree of nodes rooted at a group. A node is:

```ts
interface SceneNode {
  id?: number               // stable identity (for animation targeting)
  transform?: Transform     // translate + scale
  opacity?: number          // 0..1, default 1
  clip?: ShapeGeometry      // clip this node + subtree (GPU backend)
  kind: NodeKind            // what it is
  children?: SceneNode[]    // ordered; draw order is array order
}
```

Children inherit **nothing implicitly except draw order** — transform and opacity composition down the tree is the renderer's responsibility, not stored on the nodes.

## NodeKind

The `kind` is an internally-tagged enum (`{ "type": "..." }`). The five kinds:

### `group`

A pure container — no visual of its own, just a transform/opacity/clip and children. Use it to move or fade a subtree together.

```json
{ "type": "group" }
```

### `text`

A run of text. Font selection, shaping, and layout belong to the typography engine; the node carries only what the author specified.

```json
{ "type": "text", "content": "Hello ONDA", "font_size": 96, "color": { "r": 1, "g": 1, "b": 1 } }
```

`font_size` defaults to `48`, `color` to white.

### `image`

A bitmap reference by `src`. **Note:** image nodes are part of the model, but the current renderers do not yet draw them.

```json
{ "type": "image", "src": "assets/logo.png" }
```

### `shape`

A vector shape: a `geometry` plus optional paint. The geometry is one of `rect` (with optional `corner_radius`), `ellipse`, or `path` (SVG path data).

```json
{
  "type": "shape",
  "geometry": { "shape": "rect", "size": { "width": 200, "height": 100 }, "corner_radius": 8 },
  "fill": { "r": 0.1, "g": 0.2, "b": 0.9 }
}
```

Paint is `fill` (solid color), `gradient` (linear or radial — takes precedence over `fill`), and `stroke` (`{ color, width }`).

### `svg`

A reference to an SVG document — inline `markup` and/or a file `src` — expanded into vector path nodes by `onda-svg` before rendering. See [SVG import](/guide/svg).

```json
{ "type": "svg", "src": "badge.svg" }
```

## Authoring nodes

You rarely write nodes by hand. In React, each component emits one node kind:

| Component     | Node kind     |
| ------------- | ------------- |
| `<Group>`     | `group`       |
| `<Text>`      | `text`        |
| `<Image>`     | `image`       |
| `<Rect>`      | `shape` (rect)|
| `<Ellipse>`   | `shape` (ellipse) |
| `<Path>`      | `shape` (path)|
| `<Svg>`       | `svg`         |

See [Authoring with React](/guide/authoring-react) for the component props, and [Transforms, opacity & clip](/concepts/transforms) for the shared placement model.
