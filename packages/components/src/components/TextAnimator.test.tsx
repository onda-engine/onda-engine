import { Composition, type Scene, type SceneNode, renderFrame } from '@onda-engine/react'
import { describe, expect, it } from 'vitest'
import { TextAnimator } from './TextAnimator.js'

/** The TextAnimator renders a single <Group> whose children are the unit nodes. */
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
const op = (n: SceneNode) => n.opacity ?? 1

describe('TextAnimator — units', () => {
  it('emits one glyph node per non-space character (spaces advance, emit nothing)', () => {
    expect(at(<TextAnimator text="ab c" units="glyph" />, 120).map(content)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('groups glyphs into whitespace-delimited words', () => {
    expect(at(<TextAnimator text="hello world" units="word" />, 120).map(content)).toEqual([
      'hello',
      'world',
    ])
  })

  it('splits on newlines for line units', () => {
    expect(at(<TextAnimator text={'first\nsecond'} units="line" />, 120).map(content)).toEqual([
      'first',
      'second',
    ])
  })

  it('stacks multi-line text on separate baselines', () => {
    const u = at(<TextAnimator text={'a\nb'} units="glyph" />, 120)
    const y = (n: SceneNode) => n.transform?.translate?.y ?? 0
    expect(u.map(content)).toEqual(['a', 'b'])
    expect(y(u[1]!)).toBeGreaterThan(y(u[0]!)) // second line sits below the first
  })
})

describe('TextAnimator — stagger order', () => {
  it('forward: earlier units lead later ones', () => {
    const u = at(<TextAnimator text="abcde" units="glyph" stagger={5} />, 6)
    expect(op(u[0]!)).toBeGreaterThan(op(u[4]!))
    expect(op(u[4]!)).toBe(0) // last unit starts at frame 20 — not begun at 6
  })

  it('backward: the last unit leads', () => {
    const u = at(<TextAnimator text="abcde" units="glyph" direction="backward" stagger={5} />, 6)
    expect(op(u[4]!)).toBeGreaterThan(op(u[0]!))
  })
})

describe('TextAnimator — channels', () => {
  it('animates only the requested channels', () => {
    // Only `y` requested → opacity stays at rest (1) and is visible from frame 0.
    const u = at(<TextAnimator text="hi" animate={{ y: [40, 0] }} />, 0)
    expect(u[0]!.opacity).toBe(1)
  })

  it('eases the y channel from `from` to `to`', () => {
    const y = (frame: number) =>
      at(<TextAnimator text="hi" animate={{ y: [40, 0] }} />, frame)[0]!.transform!.translate!.y!
    expect(y(0) - y(120)).toBeCloseTo(40, 0) // 40px of rise consumed once settled
  })

  it('interpolates color between frames when animated', () => {
    const colorAt = (frame: number) => {
      const n = at(<TextAnimator text="x" animate={{ color: ['#000000', '#ffffff'] }} />, frame)[0]!
      return n.kind.type === 'text' ? JSON.stringify(n.kind.color) : undefined
    }
    expect(colorAt(0)).not.toBe(colorAt(120))
  })
})
