/** @jsxRuntime automatic @jsxImportSource react */
//! Author a scene in JSX, emit the engine's scene-graph JSON.
//!
//! Run:
//!   pnpm --filter @onda-engine/react exec tsx examples/hello.tsx out.json
//! then render it with the engine:
//!   cargo run -p onda-cli -- render out.json out.png

import { writeFileSync } from 'node:fs'
import { Composition, Rect, Text, renderToSceneJSON } from '@onda-engine/react'

const scene = (
  <Composition width={1200} height={360} fps={30} durationInFrames={1}>
    <Rect width={1200} height={360} fill="#0a0d17" />
    <Rect x={96} y={250} width={520} height={10} cornerRadius={5} fill="#2974f2" />
    <Text x={96} y={110} fontSize={96} color="#ffffff">
      Hello ONDA
    </Text>
  </Composition>
)

const out = process.argv[2] ?? 'hello-react.json'
writeFileSync(out, renderToSceneJSON(scene))
console.log(`wrote ${out}`)
