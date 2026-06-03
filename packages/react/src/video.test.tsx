import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Composition, Video, renderFrame } from './index.js'

/** Resolve `<Video>`'s emitted source `time` at a given composition frame. */
function videoTime(
  frame: number,
  props: { startFrom?: number; endAt?: number; loop?: boolean; playbackRate?: number },
): number | undefined {
  const el = createElement(
    Composition,
    { width: 100, height: 100, fps: 10, durationInFrames: 100 },
    createElement(Video, { src: 'v.mp4', ...props }),
  )
  const kind = renderFrame(el, frame).root.children?.[0]?.kind
  return kind?.type === 'video' ? kind.time : undefined
}

describe('Video source-time resolution', () => {
  it('advances from startFrom at playbackRate (fps 10)', () => {
    expect(videoTime(0, { startFrom: 2 })).toBeCloseTo(2) // frame 0 → trim-head
    expect(videoTime(10, { startFrom: 2 })).toBeCloseTo(3) // +1s realtime
    expect(videoTime(10, { startFrom: 0, playbackRate: 2 })).toBeCloseTo(2) // 2× fast
  })

  it('trims the tail — holds the last frame past endAt', () => {
    // startFrom 2, endAt 5; frame 35 = source 5.5 → clamped to 5.
    expect(videoTime(35, { startFrom: 2, endAt: 5 })).toBeCloseTo(5)
    expect(videoTime(20, { startFrom: 2, endAt: 5 })).toBeCloseTo(4) // within span, unchanged
  })

  it('loops the trimmed span [startFrom, endAt)', () => {
    // span = 3s; frame 35 = source 5.5 → wraps to 2.5.
    expect(videoTime(35, { startFrom: 2, endAt: 5, loop: true })).toBeCloseTo(2.5)
    expect(videoTime(30, { startFrom: 2, endAt: 5, loop: true })).toBeCloseTo(2) // wrap boundary
  })
})
