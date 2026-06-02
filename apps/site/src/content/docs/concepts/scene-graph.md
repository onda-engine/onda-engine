---
title: "The scene graph"
---

The scene graph is the heart of ONDA. Per the engine charter, it is the **universal language**: React, hand-written JSON, visual editors, and AI systems all compile down to this one representation, and the renderer consumes only this.

```txt
React  ┐
JSON   ├──→  Scene Graph  ──→  Renderer  ──→  Frame
AI     ┘
```

There is only one runtime. Everything that produces a scene graph renders the same way.

## It's just data

A scene graph is plain, `serde`-serializable data — framework-agnostic, with no reference to React, the DOM, a browser, or GPU types. That's what makes it a good interchange format: a frontend can hand the engine a raw JSON document and it renders identically to one emitted by the React reconciler.

A scene is a `Composition` (resolution + timing) paired with a tree of nodes rooted at a group:

```json
{
  "composition": { "width": 1280, "height": 720, "fps": 60, "duration_in_frames": 120 },
  "root": {
    "kind": { "type": "group" },
    "children": [
      { "kind": { "type": "text", "content": "Hi" } }
    ]
  }
}
```

Omitted fields fall back to defaults (e.g. `opacity` defaults to `1.0`, text `font_size` to `48`, color to white). The full schema is in the [scene-graph JSON reference](/api/scene-json).

## Nodes

Every node carries shared properties plus a kind-specific payload and an ordered list of children:

- **`id`** — an optional stable identifier (a node only needs one if an animation timeline targets it).
- **`transform`** — translation + scale (no rotation/skew yet).
- **`opacity`** — `0.0..=1.0`.
- **`clip`** — an optional clip geometry; the node and its subtree are clipped to it (GPU backend).
- **`kind`** — what the node *is* (see below).
- **`children`** — ordered; they inherit nothing implicitly except draw order. Transform/opacity composition is the renderer's job.

### Node kinds

| Kind     | Payload                                                        |
| -------- | ------------------------------------------------------------- |
| `group`  | A pure container — no visual, just transform + children.      |
| `text`   | `content`, optional `font_size`, optional `color`.            |
| `image`  | `src` (modeled, but not yet drawn by the renderers).          |
| `shape`  | A `geometry` (rect / ellipse / path) plus optional `fill`, `gradient`, `stroke`. |
| `svg`    | `src` and/or `markup`, expanded into vector nodes by `onda-svg`. |

## Animation evaluates to a static scene

The scene graph itself is **static**. Animation layers on top: a `Timeline` of keyframe tracks (each targeting a node by id and a property) is *evaluated at a frame* to produce a fully static scene — which the renderer then renders like any other.

So motion is simply: **evaluate the timeline at frame N, render the result, repeat.** This is why everything stays deterministic and why a React component can be a pure function of `useCurrentFrame()` — each frame is just a different static scene.

## Why this design

- **One renderer to build and optimize** — every frontend funnels into it.
- **Determinism** — pure data + pure evaluation = identical output every run.
- **AI-native** — a model can emit a scene graph directly, no code generation required.

Next: [Composition & nodes](/concepts/composition) and [Transforms, opacity & clip](/concepts/transforms).
