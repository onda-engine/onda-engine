---
title: "SVG import"
---

Use SVG documents in JSX. `<Svg>` takes either inline `markup` (self-contained) or a file `src` (resolved by the engine at render time, relative to the scene JSON's directory). The engine expands it into vector path nodes via `onda-svg`, so it renders through the GPU (Vello) backend. Mirrors `packages/react/examples/svg.tsx`.

```tsx
import { readFileSync, writeFileSync } from 'node:fs'
import { Composition, Rect, Svg, Text, renderToSceneJSON } from 'onda-engine/react'

// One badge by inline markup (self-contained)...
const inlineBadge = readFileSync(new URL('./assets/badge.svg', import.meta.url), 'utf8')

const scene = (
  <Composition width={520} height={220} fps={30} durationInFrames={1}>
    <Rect width={520} height={220} fill="#1a1d27" />
    <Svg x={40} y={30} markup={inlineBadge} />
    {/* ...and one by file src (resolved relative to the scene JSON). */}
    <Svg x={240} y={30} src="badge.svg" />
    <Text x={418} y={92} fontSize={40} color="#ffffff">
      SVG
    </Text>
  </Composition>
)

const out = process.argv[2] ?? 'svg.json'
writeFileSync(out, renderToSceneJSON(scene))
console.log(`wrote ${out}`)
```

## Run it

Write the scene JSON **next to the SVG asset** so the file `src` resolves, then render:

```bash
pnpm --filter @onda-engine/react exec tsx examples/svg.tsx examples/assets/svg.json
cargo run -p onda-cli -- render examples/assets/svg.json svg.png
```

## Notes

- **Inline `markup`** is embedded in the scene JSON and is self-contained.
- **File `src`** is resolved by the engine at render time, **relative to the input JSON's directory** — which is why the scene JSON is written into `examples/assets/` next to `badge.svg`.
- `onda-svg` flattens the SVG into solid-colored vector path nodes. **Gradients, patterns, embedded raster images, and `<text>` are skipped in v1** — see [SVG import](/guide/svg).
- SVG content renders on the **GPU (Vello) backend** (it becomes paths, which the CPU backend skips).
