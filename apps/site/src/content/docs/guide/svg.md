---
title: "SVG import"
---

ONDA can import SVG documents (logos, icons) and expand them into native vector path nodes. This happens in the `onda-svg` crate, which keeps the scene graph itself free of any SVG knowledge — the expansion runs as a pass before a scene is handed to a renderer.

## In React: `<Svg>`

The `<Svg>` component takes either inline `markup` or a file `src`:

```tsx
import { readFileSync } from 'node:fs'
import { Composition, Rect, Svg, Text, renderToSceneJSON } from 'onda-engine/react'

const badge = readFileSync(new URL('./assets/badge.svg', import.meta.url), 'utf8')

const scene = (
  <Composition width={520} height={220} fps={30} durationInFrames={1}>
    <Rect width={520} height={220} fill="#1a1d27" />

    {/* Inline markup — self-contained. */}
    <Svg x={40} y={30} markup={badge} />

    {/* File src — resolved relative to the scene JSON's directory at render time. */}
    <Svg x={240} y={30} src="badge.svg" />
  </Composition>
)
```

- **`markup`** is self-contained and wins when both are present.
- **`src`** is resolved by the engine **at render time, relative to the scene JSON's directory** — so write the scene JSON next to the SVG asset. Place and size with `x`/`y`/`scaleX`/`scaleY`.
- SVG nodes render on the GPU (Vello) backend (they expand to paths, which the CPU backend skips).

## How expansion works

When the CLI loads a scene, it runs `onda_svg::expand_svg` before rendering. For each `<svg>` node it:

1. Parses the SVG with **`usvg`** (which resolves CSS, units, `use`/defs, and transforms).
2. Flattens the document into a tree of **path** shape nodes.
3. Bakes each path's *absolute* transform directly into its geometry (because ONDA's transform is translate + scale only — no rotation/skew), so the emitted nodes carry identity transforms and the path data lives in the document's coordinate space.
4. Replaces the `<svg>` node with a **group** that keeps the original node's id/transform/opacity/clip, whose children are the imported paths followed by any original children.

Non-SVG subtrees are walked and returned unchanged; an SVG-free scene passes through as a no-op.

## What's supported in v1

`onda-svg` v1 covers **filled and stroked vector paths with solid colors** — the vast majority of icons and logos. The intrinsic document size is read from the SVG.

**Skipped for now:**

- **Gradients and patterns** — a gradient/pattern-only paint maps to no fill, so such paths are dropped.
- **Embedded raster images** (`<image>`).
- **`<text>`** elements.

## Rust API

If you're working in Rust rather than through the CLI:

```rust
use onda_svg::{import_svg, import_svg_file, expand_svg};

// Parse markup into an ONDA Node tree + intrinsic size.
let imported = import_svg(svg_markup)?;        // -> ImportedSvg { root, size }
let imported = import_svg_file("logo.svg")?;   // read from disk

// Expand every Svg node in a Scene (file `src`s resolve relative to base_dir).
let expanded = expand_svg(&scene, base_dir)?;
```
