import { Composition, type Scene, type SceneNode, renderFrame } from '@onda/react'
import { describe, expect, it } from 'vitest'
import { KineticText } from './KineticText.js'
import { TextAnimator } from './TextAnimator.js'

function units(scene: Scene): SceneNode[] {
  const group = scene.root.children?.[0] as SceneNode
  return group.children ?? []
}
function content(n: SceneNode): string {
  return n.kind.type === 'text' ? n.kind.content : ''
}
function at(node: React.ReactNode, frame: number): SceneNode[] {
  return units(
    renderFrame(
      <Composition width={1280} height={720} fps={30} durationInFrames={120}>
        {node}
      </Composition>,
      frame,
    ),
  )
}
function tree(node: React.ReactNode, frame: number): string {
  return JSON.stringify(at(node, frame))
}

describe('KineticText — facade over TextAnimator', () => {
  // The from→to presets must be EXACTLY TextAnimator with the mapped channels —
  // same placement, same transforms, same effects — byte-identical scene tree.
  it('rise preset == TextAnimator { y:[24,0], opacity:[0,1] }', () => {
    expect(tree(<KineticText text="hi" preset="rise" />, 10)).toBe(
      tree(<TextAnimator text="hi" units="glyph" animate={{ y: [24, 0], opacity: [0, 1] }} />, 10),
    )
  })

  it('scale preset == TextAnimator { scale:[0.6,1], opacity:[0,1] } (center pivot)', () => {
    expect(tree(<KineticText text="hi" preset="scale" />, 10)).toBe(
      tree(
        <TextAnimator text="hi" units="glyph" animate={{ scale: [0.6, 1], opacity: [0, 1] }} />,
        10,
      ),
    )
  })

  it('blur preset == TextAnimator { blur:[12,0], opacity:[0,1] } (RTT effect)', () => {
    expect(tree(<KineticText text="hi" preset="blur" />, 10)).toBe(
      tree(
        <TextAnimator text="hi" units="glyph" animate={{ blur: [12, 0], opacity: [0, 1] }} />,
        10,
      ),
    )
  })
})

describe('KineticText — wave (the procedural preset, own path)', () => {
  it('emits one glyph node per non-space character and ripples in', () => {
    const u = at(<KineticText text="wave it" preset="wave" />, 0)
    expect(u.map(content)).toEqual(['w', 'a', 'v', 'e', 'i', 't'])
    expect(u[0]!.opacity).toBe(0) // hidden at frame 0, fades in with the ripple
  })
})
