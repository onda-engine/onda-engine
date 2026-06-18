/** @jsxRuntime automatic @jsxImportSource react */
//! Generic demo harness — render any @onda-engine/components component by name, on a
//! dark background, to scene-graph JSON for `onda render`.
//!
//!   tsx demo.tsx <Name> <frame> '<propsJSON>'  >  scene.json
//!   onda render scene.json out.png --backend vello
//!
//! Wrapper components (FadeIn / RotateIn / …) receive a sample <Text> child so
//! there is something to animate; self-rendering components ignore it.

import * as Lib from '@onda-engine/components'
import { Composition, Rect, Text, renderFrame } from '@onda-engine/react'
import { createElement as h } from 'react'

const W = 1280
const H = 720

const name = process.argv[2] ?? 'TitleCard'
const frame = Number(process.argv[3] ?? '30')
const props: Record<string, unknown> = process.argv[4] ? JSON.parse(process.argv[4]) : {}

const registry = Lib as Record<string, unknown>
const Comp = registry[name] as ((p: Record<string, unknown>) => unknown) | undefined
if (typeof Comp !== 'function') {
  process.stderr.write(`unknown component: ${name}\n`)
  process.exit(1)
}

const sample = h(Text, { fontSize: 120, color: '#ffffff', fontWeight: 700 }, 'Onda')
const el = h(
  Composition,
  { width: W, height: H, fps: 30, durationInFrames: 120 },
  h(Rect, { width: W, height: H, fill: '#0a0d17' }),
  // biome-ignore lint/suspicious/noExplicitAny: dynamic registry lookup for a dev harness
  h(Comp as any, props, sample),
)
process.stdout.write(JSON.stringify(renderFrame(el, frame)))
