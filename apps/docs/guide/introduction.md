# What is ONDA?

ONDA is an **open-source, GPU-native, browser-free motion-graphics engine in Rust**.

> Motion graphics at GPU speed. No browser.

It is not a video editor, not an AI product, and not a design tool. It is a **rendering engine and runtime** for creating cinematic motion graphics and videos programmatically — for developers, creators, AI agents, and future visual tools.

You author scenes in React/JSX (the same developer experience that made Remotion successful), and ONDA compiles them to a plain **scene-graph JSON** that a native Rust renderer turns into frames — with no DOM, no Chromium, and no screenshot pipeline anywhere.

## The architecture, in one line

```txt
React  →  Scene Graph  →  Native Renderer  →  GPU  →  Frame
```

Compare that to the dominant approach (Remotion):

```txt
React  →  DOM  →  headless Chromium  →  screenshot per frame  →  encode  →  Video
```

The browser becomes a deployment target instead of the rendering substrate. The **renderer is the source of truth**, and the **scene graph is the universal language**: React, hand-written JSON, and AI systems all emit the same representation, and the renderer consumes only that.

## What exists today

ONDA is early. This documentation describes **only what is implemented and verifiable in the codebase today** — not aspirational features. Concretely, you can:

- **Author scenes in React** with `@onda/react`: `<Composition>`, `<Group>`, `<Rect>`, `<Ellipse>`, `<Path>`, `<Text>`, `<Image>`, `<Svg>`, the `useCurrentFrame` / `useVideoConfig` hooks, `interpolate` / `Easing` / `cubicBezier`, `spring`, and the `<Sequence>` / `<Series>` / `<Loop>` timeline primitives.
- **Emit scene-graph JSON** from that React tree (`renderToSceneJSON`, `renderFramesJSON`) — or hand-write the JSON, or have an AI produce it.
- **Render** a scene to a PNG still, or a movie to an animated GIF or MP4, with the `onda` CLI.
- **Choose a backend**: the GPU-native **Vello** vector backend (anti-aliased fills/strokes, paths, gradients, clips, per-glyph vector text), or a deterministic **CPU** reference rasterizer (`--backend auto|vello|cpu`).
- **Import SVG** documents (`<Svg src | markup>`) — they expand into vector path nodes.

## What is not here yet

To stay honest, these are explicitly **not** implemented today (and so are not documented as usable APIs):

- **Audio and video** nodes (no `<Audio>` / `<Video>`); the `<Image>` node carries a `src` but is not yet drawn by the renderers.
- A **real-time Player / Studio** with hot reload (a basic player package exists but is out of scope for this engine documentation).
- **Layout/flexbox**, blur/filters/blend modes, variable-font axes, OpenType feature controls, color/emoji glyphs, and animation of properties beyond opacity/translate/scale.
- The **CPU backend** does not draw strokes, paths, gradients, clips, anti-aliasing, or rounded corners — those are GPU-only. See [Backends](/guide/backends).

For the full picture of where ONDA stands against Remotion and the Rust rendering state of the art, see the gap analysis in the repository (`techspecs/gap-analysis.md`).

## Where to go next

- **[Why not Remotion?](/guide/why-onda)** — the honest performance framing.
- **[Getting started](/guide/getting-started)** — clone, build, render your first scene.
- **[The scene graph](/concepts/scene-graph)** — the core concept everything else builds on.
- **[Authoring with React](/guide/authoring-react)** — write motion in JSX.
