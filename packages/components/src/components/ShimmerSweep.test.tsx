import { Composition, type Scene, type SceneNode, renderFrame } from '@onda/react'
import { describe, expect, it } from 'vitest'
import { ShimmerSweep } from './ShimmerSweep.js'

function scene(node: React.ReactNode, frame: number): Scene {
  return renderFrame(
    <Composition width={1280} height={720} fps={30} durationInFrames={60}>
      {node}
    </Composition>,
    frame,
  )
}
// ShimmerSweep root <Group> → [ base Text, matte'd shine <Group> ].
const shineGroup = (s: Scene): SceneNode =>
  ((s.root.children?.[0] as SceneNode).children?.[1] as SceneNode)
const baseText = (s: Scene): SceneNode =>
  ((s.root.children?.[0] as SceneNode).children?.[0] as SceneNode)

describe('ShimmerSweep — shine masked to glyphs, not a box', () => {
  it('masks the shine with a TEXT alpha matte (not a rectangular clip)', () => {
    const shine = shineGroup(scene(<ShimmerSweep text="Onda" />, 10))
    expect(shine.matte).toBeDefined()
    expect(shine.matte?.mode).toBe('alpha')
    expect(shine.matte?.source.kind.type).toBe('text') // glyph mask, not a rect box
    expect(shine.clip).toBeUndefined() // the old box clip is gone
  })

  it('the matte mask is the same word as the base text', () => {
    const s = scene(<ShimmerSweep text="Shine" />, 10)
    const src = shineGroup(s).matte?.source
    const matteText = src && src.kind.type === 'text' ? src.kind.content : ''
    const base = baseText(s)
    const baseContent = base.kind.type === 'text' ? base.kind.content : ''
    expect(matteText).toBe('Shine')
    expect(baseContent).toBe('Shine')
  })
})
