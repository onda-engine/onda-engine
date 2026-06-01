import { describe, expect, it } from 'vitest'
import { Composition, Easing, Text, interpolate, renderFrames, useCurrentFrame } from './index.js'

describe('interpolate', () => {
  it('maps and clamps by default', () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50)
    expect(interpolate(-3, [0, 10], [0, 100])).toBe(0) // clamp left
    expect(interpolate(99, [0, 10], [0, 100])).toBe(100) // clamp right
  })

  it('extends when asked and applies easing', () => {
    expect(interpolate(20, [0, 10], [0, 100], { extrapolateRight: 'extend' })).toBe(200)
    expect(interpolate(5, [0, 10], [0, 100], { easing: Easing.easeInQuad })).toBe(25)
  })

  it('walks multi-stop ranges', () => {
    expect(interpolate(15, [0, 10, 20], [0, 100, 200])).toBe(150)
  })

  it('rejects mismatched ranges', () => {
    expect(() => interpolate(0, [0, 1], [0])).toThrow()
  })
})

describe('renderFrames', () => {
  function FadingTitle() {
    const frame = useCurrentFrame()
    const opacity = interpolate(frame, [0, 2], [0, 1])
    return (
      <Text id={1} opacity={opacity}>
        Hi
      </Text>
    )
  }

  it('evaluates useCurrentFrame per frame', () => {
    const frames = renderFrames(
      <Composition width={10} height={10} fps={2} durationInFrames={3}>
        <FadingTitle />
      </Composition>,
    )
    expect(frames).toHaveLength(3) // durationInFrames
    const opacityAt = (i: number) => frames[i]?.root.children?.[0]?.opacity
    expect(opacityAt(0)).toBe(0)
    expect(opacityAt(1)).toBe(0.5)
    expect(opacityAt(2)).toBe(1)
    // Each frame carries the composition (so a renderer/CLI knows fps).
    expect(frames[0]?.composition).toEqual({
      width: 10,
      height: 10,
      fps: 2,
      duration_in_frames: 3,
    })
  })
})
