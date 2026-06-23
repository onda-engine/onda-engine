import { Composition, type Scene, type SceneNode, renderFrame } from '@onda-engine/react'
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

describe('KineticText — scatter (procedural, random per-glyph entrance)', () => {
  const txy = (n: SceneNode): [number, number] => [
    Math.round(n.transform?.translate?.x ?? 0),
    Math.round(n.transform?.translate?.y ?? 0),
  ]

  it('emits one glyph node per non-space character, hidden at frame 0', () => {
    const u = at(<KineticText text="ONDA" preset="scatter" />, 0)
    expect(u.map(content)).toEqual(['O', 'N', 'D', 'A'])
    expect(u[0]!.opacity).toBe(0) // hidden at frame 0, flies in toward rest
  })

  it('is deterministic — the same frame renders byte-identically every run', () => {
    expect(tree(<KineticText text="STUDIO" preset="scatter" />, 7)).toBe(
      tree(<KineticText text="STUDIO" preset="scatter" />, 7),
    )
  })

  it('paints each glyph from the palette — 4 distinct colors vs 1 for mono', () => {
    const colorKey = (n: SceneNode): string =>
      n.kind.type === 'text' && n.kind.color
        ? `${n.kind.color.r},${n.kind.color.g},${n.kind.color.b}`
        : ''
    // A 4-color palette over "ONDA" → four distinct per-glyph colors.
    const painted = at(
      <KineticText
        text="ONDA"
        preset="scatter"
        colors={['#7c3aed', '#fb6514', '#ff4d8d', '#19e0d2']}
      />,
      70,
    ).map(colorKey)
    expect(new Set(painted).size).toBe(4)
    // ...and the same scatter with a single color paints every glyph alike.
    const mono = at(<KineticText text="ONDA" preset="scatter" color="#0a0a0f" />, 70).map(colorKey)
    expect(new Set(mono).size).toBe(1)
  })

  it('exit mode scatters the glyphs back out — visible mid-hold, gone by the end', () => {
    // Composition is 120 frames; exit eats the final ~14. At a held mid-frame the
    // wordmark is fully visible; on the last frame it has scattered out (opacity → 0).
    const opacities = (frame: number) =>
      at(<KineticText text="ONDA" preset="scatter" exit />, frame).map((n) => n.opacity ?? 1)
    expect(Math.max(...opacities(95))).toBeGreaterThan(0.9) // held, visible
    expect(Math.max(...opacities(119))).toBeLessThan(0.2) // scattered out by the end
  })

  it('settles essentially onto the shared kerned layout (entrance decays to rest)', () => {
    // Well past the entrance, the scattered glyphs resolve onto the same positions
    // the shared glyph-line places them — proving only the entrance differs, never
    // the layout. (Within ~1px: the settle spring asymptotes near, not exactly, 1.)
    const settled = 119
    const scattered = at(<KineticText text="ONDA" preset="scatter" />, settled)
    const fade = at(<KineticText text="ONDA" preset="fade" />, settled)
    scattered.forEach((n, i) => {
      const [sx, sy] = txy(n)
      const [fx, fy] = txy(fade[i]!)
      expect(Math.abs(sx - fx)).toBeLessThanOrEqual(1)
      expect(Math.abs(sy - fy)).toBeLessThanOrEqual(1)
    })
  })
})
