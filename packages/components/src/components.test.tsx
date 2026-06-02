import { Composition, type Scene, type SceneNode, renderFrame } from '@onda/react'
import { describe, expect, it } from 'vitest'
import { StatCard } from './components/StatCard.js'
import { TitleCard } from './components/TitleCard.js'

/** The TitleCard's AbsoluteFill → inner Flex → [titleFadeIn, subtitleFadeIn]. */
function titleAndSubtitleOpacity(scene: Scene): { title: number; subtitle: number } {
  const fill = scene.root.children?.[0] as SceneNode
  const flex = fill.children?.[0] as SceneNode
  const title = flex.children?.[0] as SceneNode
  const subtitle = flex.children?.[1] as SceneNode
  return { title: title.opacity ?? 1, subtitle: subtitle.opacity ?? 1 }
}

const titleEl = (
  <Composition width={1280} height={720} fps={30} durationInFrames={90}>
    <TitleCard title="ONDA" subtitle="no browser" />
  </Composition>
)

describe('TitleCard', () => {
  it('emits a centered flex column layout', () => {
    const scene = renderFrame(titleEl, 40)
    const fill = scene.root.children?.[0] as SceneNode
    expect(fill.layout?.direction).toBe('column')
    expect(fill.layout?.justify).toBe('center')
    expect(fill.layout?.align).toBe('center')
    // fills the composition so layout can center within it
    expect(fill.layout?.width).toBe(1280)
    expect(fill.layout?.height).toBe(720)
  })

  it('fades the title in, then the subtitle after a stagger', () => {
    const at0 = titleAndSubtitleOpacity(renderFrame(titleEl, 0))
    expect(at0.title).toBe(0)
    expect(at0.subtitle).toBe(0)

    // Subtitle is delayed by staggerFrames(2) = 8 frames — still hidden at 4.
    const at4 = titleAndSubtitleOpacity(renderFrame(titleEl, 4))
    expect(at4.title).toBeGreaterThan(0)
    expect(at4.subtitle).toBe(0)

    const at40 = titleAndSubtitleOpacity(renderFrame(titleEl, 40))
    expect(at40.title).toBeGreaterThan(0.9)
    expect(at40.subtitle).toBeGreaterThan(0.9)
  })
})

describe('StatCard', () => {
  it('stacks value, accent bar, and label in a centered column', () => {
    const scene = renderFrame(
      <Composition width={1280} height={720} fps={30} durationInFrames={90}>
        <StatCard value="9.3×" label="faster" />
      </Composition>,
      40,
    )
    const fill = scene.root.children?.[0] as SceneNode
    const flex = fill.children?.[0] as SceneNode
    expect(flex.children).toHaveLength(3) // value, accent rect, label
    // every part has settled in by frame 40
    for (const part of flex.children ?? []) {
      expect(part.opacity ?? 1).toBeGreaterThan(0.9)
    }
  })
})
