import { describe, expect, it } from 'vitest'
import { estimatePathLength } from './path-length.js'

describe('estimatePathLength', () => {
  it('measures a straight line exactly', () => {
    expect(estimatePathLength('M 0 0 L 100 0')).toBeCloseTo(100, 5)
  })

  it('sums a closed square perimeter (incl. the Z back to start)', () => {
    // 100×100 square: 4 sides = 400.
    expect(estimatePathLength('M 0 0 L 100 0 L 100 100 L 0 100 Z')).toBeCloseTo(400, 4)
  })

  it('handles H/V shorthand and relative coords', () => {
    // Absolute H/V and relative l should both land at the same 100×100 box edges.
    expect(estimatePathLength('M 0 0 H 100 V 100 H 0 Z')).toBeCloseTo(400, 4)
    expect(estimatePathLength('M 0 0 l 100 0 l 0 100 l -100 0 Z')).toBeCloseTo(400, 4)
  })

  it('approximates a quadratic curve close to its true length', () => {
    // A symmetric arch (control at (100,−80)); its true length sits between the
    // chord (200) and the control polygon (2·√(100²+80²) ≈ 256). The flattened
    // estimate lands around 220 and is stable.
    const len = estimatePathLength('M 0 0 Q 100 -80 200 0')
    expect(len).toBeGreaterThan(210)
    expect(len).toBeLessThan(230)
  })

  it('extends smoothly across a T (smooth-quad) continuation', () => {
    // The default LogoSting mark — one continuous M/Q/T stroke. Must be a single
    // finite positive length (drives the dash period).
    const len = estimatePathLength('M 50 60 Q 100 20 150 60 T 250 60')
    expect(Number.isFinite(len)).toBe(true)
    expect(len).toBeGreaterThan(200)
  })

  it('returns 0 for an empty path', () => {
    expect(estimatePathLength('')).toBe(0)
  })
})
