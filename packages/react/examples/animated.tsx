/** @jsxRuntime automatic @jsxImportSource react */
//! Author motion in JSX (Remotion-style): components are pure functions of the
//! current frame. Emits a per-frame array of scene graphs.
//!
//! Run:
//!   pnpm --filter @onda-engine/react exec tsx examples/animated.tsx frames.json
//! then encode it with the engine:
//!   cargo run -p onda-cli -- export-frames frames.json out.mp4

import { writeFileSync } from 'node:fs'
import {
  Composition,
  Easing,
  Rect,
  Text,
  interpolate,
  renderFramesJSON,
  useCurrentFrame,
} from '@onda-engine/react'

function Title() {
  const frame = useCurrentFrame()
  // Fade and slide into place over the first half-second (15 frames @ 30fps).
  const opacity = interpolate(frame, [0, 15], [0, 1], { easing: Easing.easeOutCubic })
  const y = interpolate(frame, [0, 15], [150, 110], { easing: Easing.easeOutCubic })
  return (
    <Text x={96} y={y} fontSize={96} color="#ffffff" opacity={opacity}>
      Hello ONDA
    </Text>
  )
}

const movie = (
  <Composition width={1200} height={360} fps={30} durationInFrames={30}>
    <Rect width={1200} height={360} fill="#0a0d17" />
    <Rect x={96} y={250} width={520} height={10} cornerRadius={5} fill="#2974f2" />
    <Title />
  </Composition>
)

const out = process.argv[2] ?? 'frames.json'
writeFileSync(out, renderFramesJSON(movie))
console.log(`wrote ${out}`)
