/** @jsxRuntime automatic @jsxImportSource react */
//! Use SVG documents in JSX. `<Svg>` takes either inline `markup` (self-
//! contained) or a file `src` (resolved by the engine at render time, relative
//! to the scene JSON's directory). The engine expands it into vector nodes via
//! `onda-svg`, so it renders through the GPU (Vello) backend.
//!
//! Run (write the scene JSON next to the SVG asset so `src` resolves):
//!   pnpm --filter @onda/react exec tsx examples/svg.tsx examples/assets/svg.json
//! then render it:
//!   cargo run -p onda-cli -- render examples/assets/svg.json svg.png

import { readFileSync, writeFileSync } from 'node:fs'
import { Composition, Rect, Svg, Text, renderToSceneJSON } from '@onda/react'

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
