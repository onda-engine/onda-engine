import { describe, expect, it } from 'vitest'
import {
  Composition,
  Rect,
  type TransitionPresentation,
  TransitionSeries,
  clockWipe,
  fade,
  flip,
  iris,
  linearTiming,
  none,
  renderFrame,
} from './index.js'
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

// ---------------------------------------------------------------------------
// Standard presentations (none / flip / clockWipe / iris).
// ---------------------------------------------------------------------------

function movieWith(presentation: TransitionPresentation) {
  return (
    <Composition width={100} height={100} fps={30} durationInFrames={60}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={30}>
          <Rect id={1} width={10} height={10} fill="#ff0000" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={presentation}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence durationInFrames={30}>
          <Rect id={2} width={10} height={10} fill="#0000ff" />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </Composition>
  )
}

/** Walk the scene and collect clip shapes, scale.x values, and faded opacities. */
function collect(root: SceneNode): {
  clips: string[]
  scaleX: number[]
  opacities: number[]
} {
  const out = { clips: [] as string[], scaleX: [] as number[], opacities: [] as number[] }
  const walk = (n: SceneNode) => {
    if (n.clip) out.clips.push(n.clip.shape)
    const sx = n.transform?.scale?.x
    if (typeof sx === 'number') out.scaleX.push(sx)
    if (typeof n.opacity === 'number' && n.opacity < 1) out.opacities.push(n.opacity)
    for (const c of n.children ?? []) walk(c)
  }
  walk(root)
  return out
}

const sortedIds = (root: SceneNode): number[] => ids(root).sort()

describe('transition presentations', () => {
  // All presentations share the series mechanics: only A before, both during
  // the [20,30) overlap, only B after.
  it.each([
    ['none', none()],
    ['flip', flip()],
    ['clockWipe', clockWipe()],
    ['iris', iris()],
  ])('%s overlaps both scenes only during the transition', (_name, presentation) => {
    const m = movieWith(presentation)
    expect(sortedIds(renderFrame(m, 5).root)).toEqual([1])
    expect(sortedIds(renderFrame(m, 25).root)).toEqual([1, 2])
    expect(sortedIds(renderFrame(m, 45).root)).toEqual([2])
  })

  it('none applies no visual effect (a cut)', () => {
    const c = collect(renderFrame(movieWith(none()), 25).root)
    expect(c.clips).toHaveLength(0)
    expect(c.opacities).toHaveLength(0)
    expect(c.scaleX.every((x) => x === 1)).toBe(true)
  })

  it('flip scales scenes horizontally about the centre', () => {
    // Frame 22 = progress 0.2: the outgoing scene is scaled to 0.6 in x.
    const c = collect(renderFrame(movieWith(flip()), 22).root)
    expect(c.scaleX.some((x) => Math.abs(x - 0.6) < 0.01)).toBe(true)
  })

  it('iris clips the incoming scene with an expanding ellipse', () => {
    const c = collect(renderFrame(movieWith(iris()), 25).root)
    expect(c.clips).toContain('ellipse')
  })

  it('clockWipe clips the incoming scene with a swept path', () => {
    const c = collect(renderFrame(movieWith(clockWipe()), 25).root)
    expect(c.clips).toContain('path')
  })
})
