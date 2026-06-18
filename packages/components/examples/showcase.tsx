/** @jsxRuntime automatic @jsxImportSource react */
//! Showcase compositions built entirely from `@onda-engine/components` — the ported
//! Onda motion language running on `@onda-engine/react` + the GPU engine. No engine
//! internals, no Chromium: author with `<TitleCard>` / `<StatCard>` exactly as
//! you would Remotion components.
//!
//! Render a still:
//!   pnpm --filter @onda-engine/react exec tsx packages/components/examples/render.tsx title 34 > /tmp/t.json
//!   onda render /tmp/t.json /tmp/t.png --backend vello

import { StatCard, TitleCard } from '@onda-engine/components'
import { Composition, Rect } from '@onda-engine/react'

const W = 1280
const H = 720
const FPS = 30
const BG = '#0a0d17'

export function TitleScene() {
  return (
    <Composition width={W} height={H} fps={FPS} durationInFrames={90}>
      <Rect width={W} height={H} fill={BG} />
      <TitleCard title="ONDA" subtitle="GPU-native motion graphics, no browser" />
    </Composition>
  )
}

export function StatScene() {
  return (
    <Composition width={W} height={H} fps={FPS} durationInFrames={90}>
      <Rect width={W} height={H} fill={BG} />
      <StatCard value="9.3×" label="faster than Remotion" />
    </Composition>
  )
}
