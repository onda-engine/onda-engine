import { describe, expect, it } from 'vitest'
import {
  entryFade,
  entryFadeRise,
  entryScale,
  entrySlide,
  exitFade,
  exitFadeFall,
  stateSwap,
} from './choreography.js'

const fps = 30

describe('choreography entries', () => {
  it('entryFade ramps opacity 0 → ~1 with no transform', () => {
    const start = entryFade({ frame: 0, fps })
    expect(start.opacity).toBe(0)
    expect(start.x).toBe(0)
    expect(start.y).toBe(0)
    expect(start.scaleX).toBe(1)
    const settled = entryFade({ frame: 60, fps, durationInFrames: 18 }).opacity
    expect(settled).toBeGreaterThan(0.99)
  })

  it('entryFadeRise rises from travelPx to ~0', () => {
    expect(entryFadeRise({ frame: 0, fps }).y).toBeCloseTo(12, 5)
    expect(entryFadeRise({ frame: 60, fps, durationInFrames: 18 }).y).toBeLessThan(0.2)
  })

  it('entrySlide starts offset in the origin direction and settles to 0', () => {
    const up0 = entrySlide({ frame: 0, fps, direction: 'up', distance: 20 })
    expect(up0.y).toBeCloseTo(20, 5) // 'up' starts below (positive y)
    expect(up0.x).toBe(0)
    const left0 = entrySlide({ frame: 0, fps, direction: 'left', distance: 20 })
    expect(left0.x).toBeCloseTo(20, 5) // 'left' starts to the right (positive x)
    expect(entrySlide({ frame: 60, fps, durationInFrames: 18, direction: 'up' }).y).toBeLessThan(
      0.3,
    )
  })

  it('entryScale scales from `from` to ~1', () => {
    expect(entryScale({ frame: 0, fps, from: 0.9 }).scaleX).toBeCloseTo(0.9, 5)
    expect(entryScale({ frame: 60, fps, durationInFrames: 18, from: 0.9 }).scaleX).toBeGreaterThan(
      0.99,
    )
  })
})

describe('choreography exits', () => {
  it('exitFade goes 1 → 0 across the duration', () => {
    expect(exitFade({ frame: 0 }).opacity).toBe(1)
    expect(exitFade({ frame: 10, durationInFrames: 10 }).opacity).toBe(0)
  })

  it('exitFadeFall fades and falls', () => {
    const done = exitFadeFall({ frame: 10, durationInFrames: 10, travelPx: 8 })
    expect(done.opacity).toBe(0)
    expect(done.y).toBeCloseTo(8, 5)
  })

  it('stateSwap crossfades old → new', () => {
    const begin = stateSwap({ frame: 0, durationInFrames: 10 })
    expect(begin.outOpacity).toBe(1)
    expect(begin.inOpacity).toBe(0)
    const end = stateSwap({ frame: 10, durationInFrames: 10 })
    expect(end.outOpacity).toBe(0)
    expect(end.inOpacity).toBe(1)
  })
})
