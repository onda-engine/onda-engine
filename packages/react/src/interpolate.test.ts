import { describe, expect, it } from 'vitest'
import { Easing, cubicBezier, interpolate } from './interpolate.js'

describe('interpolate', () => {
  it('maps through the range and clamps by default', () => {
    expect(interpolate(0, [0, 30], [0, 1])).toBe(0)
    expect(interpolate(15, [0, 30], [0, 1])).toBeCloseTo(0.5)
    expect(interpolate(30, [0, 30], [0, 1])).toBe(1)
    expect(interpolate(-10, [0, 30], [0, 1])).toBe(0) // clamp left
    expect(interpolate(99, [0, 30], [0, 1])).toBe(1) // clamp right
  })
})

describe('Easing — Remotion-compatible surface', () => {
  it('exposes the named curves Studio authors against', () => {
    // Endpoints are fixed for every easing.
    for (const name of ['linear', 'quad', 'cubic', 'sin', 'ease'] as const) {
      expect(Easing[name](0)).toBeCloseTo(0)
      expect(Easing[name](1)).toBeCloseTo(1)
    }
    expect(Easing.cubic(0.5)).toBeCloseTo(0.125) // t^3
    expect(Easing.quad(0.5)).toBeCloseTo(0.25) // t^2
  })

  it('Easing.bezier is a factory equal to cubicBezier', () => {
    const a = Easing.bezier(0.25, 0.1, 0.25, 1)
    const b = cubicBezier(0.25, 0.1, 0.25, 1)
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(a(t)).toBeCloseTo(b(t))
    }
    expect(a(0)).toBeCloseTo(0)
    expect(a(1)).toBeCloseTo(1)
  })

  it('drives interpolate as an easing option', () => {
    const eased = interpolate(0.5, [0, 1], [0, 1], { easing: Easing.bezier(0.42, 0, 1, 1) })
    expect(eased).toBeGreaterThan(0)
    expect(eased).toBeLessThan(0.5) // ease-in pulls the midpoint down
  })
})
