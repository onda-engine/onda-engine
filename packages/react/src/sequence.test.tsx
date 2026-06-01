import { describe, expect, it } from 'vitest'
import {
  Composition,
  Rect,
  Sequence,
  Series,
  renderFrame,
  spring,
  useCurrentFrame,
} from './index.js'

const rectWidth = (scene: ReturnType<typeof renderFrame>, i = 0): number | undefined => {
  const kind = scene.root.children?.[i]?.kind
  if (kind?.type === 'shape' && kind.geometry.shape === 'rect') return kind.geometry.size.width
  return undefined
}

describe('spring', () => {
  it('starts at 0, settles near the target, and maps from/to', () => {
    expect(spring({ frame: 0, fps: 30 })).toBe(0)
    expect(Math.abs(spring({ frame: 90, fps: 30 }) - 1)).toBeLessThan(0.02)
    expect(spring({ frame: 0, fps: 30, from: 100, to: 200 })).toBe(100)
  })
})

describe('Sequence', () => {
  // A bar whose width equals its local frame + 1 — reveals the shifted frame.
  function Bar() {
    const frame = useCurrentFrame()
    return <Rect width={frame + 1} height={10} fill="#ffffff" />
  }
  const movie = (
    <Composition width={100} height={20} fps={30} durationInFrames={40}>
      <Sequence from={10} durationInFrames={20}>
        <Bar />
      </Sequence>
    </Composition>
  )

  it('hides children before its window', () => {
    expect(renderFrame(movie, 5).root.children ?? []).toHaveLength(0)
  })
  it('shifts the frame so children start at 0', () => {
    expect(rectWidth(renderFrame(movie, 10))).toBe(1) // local 0
    expect(rectWidth(renderFrame(movie, 15))).toBe(6) // local 5
  })
  it('hides children after its duration', () => {
    expect(renderFrame(movie, 30).root.children ?? []).toHaveLength(0) // local 20 == duration
  })
})

describe('Series', () => {
  it('plays sequences back-to-back', () => {
    const A = () => <Rect width={1} height={1} fill="#ff0000" />
    const B = () => <Rect width={2} height={2} fill="#0000ff" />
    const movie = (
      <Composition width={10} height={10} fps={30} durationInFrames={60}>
        <Series>
          <Series.Sequence durationInFrames={20}>
            <A />
          </Series.Sequence>
          <Series.Sequence durationInFrames={20}>
            <B />
          </Series.Sequence>
        </Series>
      </Composition>
    )
    expect(rectWidth(renderFrame(movie, 5))).toBe(1) // first sequence
    expect(rectWidth(renderFrame(movie, 25))).toBe(2) // second sequence (offset 20)
  })
})
