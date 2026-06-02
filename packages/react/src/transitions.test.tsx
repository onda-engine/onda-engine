import { describe, expect, it } from 'vitest'
import { Composition, Rect, TransitionSeries, fade, linearTiming, renderFrame } from './index.js'
import type { SceneNode } from './scene.js'

/** Collect the ids of all nodes in a scene (depth-first). */
function ids(node: SceneNode, out: number[] = []): number[] {
  if (typeof node.id === 'number') out.push(node.id)
  for (const child of node.children ?? []) ids(child, out)
  return out
}

const movie = (
  <Composition width={100} height={100} fps={30} durationInFrames={60}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={30}>
        <Rect id={1} width={10} height={10} fill="#ff0000" />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 10 })}
      />
      <TransitionSeries.Sequence durationInFrames={30}>
        <Rect id={2} width={10} height={10} fill="#0000ff" />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </Composition>
)

const idsAt = (frame: number) => ids(renderFrame(movie, frame).root).sort()

describe('TransitionSeries', () => {
  it('shows only the first sequence before the transition', () => {
    expect(idsAt(5)).toEqual([1])
  })

  it('overlaps both sequences during the transition (cross-fade)', () => {
    // Transition window is frames [20, 30): A exiting, B entering — both present.
    expect(idsAt(25)).toEqual([1, 2])
  })

  it('shows only the second sequence after the transition', () => {
    // Timeline length = 30 + 30 - 10 = 50; frame 45 is inside B only.
    expect(idsAt(45)).toEqual([2])
  })

  it('cross-fades opacity in the overlap', () => {
    // At frame 25 (mid-transition), the exiting A and entering B are each ~half.
    const scene = renderFrame(movie, 25)
    const opacities: number[] = []
    const walk = (n: SceneNode) => {
      if (typeof n.opacity === 'number' && n.opacity < 1) opacities.push(n.opacity)
      for (const c of n.children ?? []) walk(c)
    }
    walk(scene.root)
    // Two faded groups (one per scene), both around 0.5.
    expect(opacities.filter((o) => Math.abs(o - 0.5) < 0.01)).toHaveLength(2)
  })
})
