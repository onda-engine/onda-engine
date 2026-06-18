/** @jsxRuntime automatic @jsxImportSource react */
//! Author vector graphics in JSX — paths, gradients, and clips — then render
//! them through the GPU (Vello) backend.
//!
//! Run:
//!   pnpm --filter @onda-engine/react exec tsx examples/vector.tsx vector.json
//! then render it with the engine (Vello by default):
//!   cargo run -p onda-cli -- render vector.json vector.png

import { writeFileSync } from 'node:fs'
import {
  Composition,
  Ellipse,
  Group,
  Path,
  Rect,
  Text,
  clipRect,
  linearGradient,
  radialGradient,
  renderToSceneJSON,
} from '@onda-engine/react'

const STAR = 'M50 0 L61 35 L98 35 L68 57 L79 91 L50 70 L21 91 L32 57 L2 35 L39 35 Z'

const scene = (
  <Composition width={640} height={280} fps={30} durationInFrames={1}>
    <Rect width={640} height={280} fill="#0a0d17" />

    {/* A gradient-filled rounded underline. */}
    <Rect
      x={40}
      y={210}
      width={360}
      height={12}
      cornerRadius={6}
      gradient={linearGradient(
        [0, 0],
        [360, 0],
        [
          { offset: 0, color: '#2974f2' },
          { offset: 1, color: '#f25a8c' },
        ],
      )}
    />

    {/* A radial-gradient disc fading to transparent. */}
    <Ellipse
      x={470}
      y={150}
      width={120}
      height={120}
      gradient={radialGradient([60, 60], 60, [
        { offset: 0, color: '#66ccff' },
        { offset: 1, color: { r: 0.4, g: 0.8, b: 1, a: 0 } },
      ])}
    />

    {/* An arbitrary path (a star) with a fill and outline. */}
    <Path x={430} y={20} d={STAR} fill="#fac81c" stroke="#806000" strokeWidth={2} />

    <Text x={40} y={60} fontSize={56} color="#ffffff">
      Vector JSX
    </Text>

    {/* Oversized text clipped to a rounded window. */}
    <Group x={40} y={120} clip={clipRect(150, 50, 12)}>
      <Text x={6} y={-8} fontSize={72} color="#3ce69a">
        CLIP
      </Text>
    </Group>
  </Composition>
)

const out = process.argv[2] ?? 'vector.json'
writeFileSync(out, renderToSceneJSON(scene))
console.log(`wrote ${out}`)
