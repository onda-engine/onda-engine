---
title: "Render functions"
---

These functions turn a React element tree (whose root must be a `<Composition>`) into ONDA scene-graph data — either an in-memory object or a JSON string for the `onda` CLI. They live in `@onda/react` and drive the custom reconciler.

```ts
import {
  renderFrame, renderToScene, renderFrames,
  renderToSceneJSON, renderFramesJSON,
} from '@onda/react'
```

## `renderFrame`

Render `element` at a specific `frame` to a static `Scene`. Components read the frame via `useCurrentFrame()`.

```ts
function renderFrame(element: ReactElement, frame: number): Scene
```

## `renderToScene`

Render the composition once, at **frame 0**.

```ts
function renderToScene(element: ReactElement): Scene
```

```ts
const scene = renderToScene(<MyComposition />)
```

## `renderFrames`

Render **every** frame `0..durationInFrames` to an array of static scenes.

```ts
function renderFrames(element: ReactElement): Scene[]
```

## `renderToSceneJSON`

Render frame 0 to a JSON string — the input for `onda render`.

```ts
function renderToSceneJSON(element: ReactElement, space?: number): string  // space default 2
```

```ts
import { writeFileSync } from 'node:fs'
writeFileSync('out.json', renderToSceneJSON(<MyComposition />))
```

```bash
cargo run -p onda-cli -- render out.json out.png
```

## `renderFramesJSON`

Render all frames to a JSON **array** of scenes — the input for `onda export-frames`.

```ts
function renderFramesJSON(element: ReactElement, space?: number): string  // space default 0 (compact)
```

```ts
import { writeFileSync } from 'node:fs'
writeFileSync('frames.json', renderFramesJSON(<MyAnimation />))
```

```bash
cargo run -p onda-cli -- export-frames frames.json out.mp4
# or: ... export-frames frames.json out.gif
```

## Which to use

| Goal                                | Function              | CLI command          |
| ----------------------------------- | --------------------- | -------------------- |
| A single still image                | `renderToSceneJSON`   | `onda render`        |
| An animation (per-frame flipbook)   | `renderFramesJSON`    | `onda export-frames` |
| Work with the scene object in JS    | `renderToScene` / `renderFrames` | — (in-process) |

## Notes

- The root element **must** be a single `<Composition>` — otherwise these throw (`render: the root element must be a single <Composition>`).
- `renderFrame` mounts the tree, serializes it, then unmounts (running effect cleanups), so each frame is rendered cleanly and independently.
- The emitted JSON round-trips exactly into the Rust `onda-scene` representation (matching field names and snake_case). See the [scene-graph JSON reference](/api/scene-json).
