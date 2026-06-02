import { describe, expect, it } from 'vitest'
import { interpolateColors } from './color.js'

describe('interpolateColors', () => {
  it('returns the endpoints at the range bounds', () => {
    expect(interpolateColors(0, [0, 1], ['#000000', '#ffffff'])).toBe('#000000')
    expect(interpolateColors(1, [0, 1], ['#000000', '#ffffff'])).toBe('#ffffff')
  })

  it('mixes channels at the midpoint', () => {
    expect(interpolateColors(0.5, [0, 1], ['#000000', '#ffffff'])).toBe('#808080')
  })

  it('clamps out-of-range inputs by default', () => {
    expect(interpolateColors(-5, [0, 1], ['#000000', '#ffffff'])).toBe('#000000')
    expect(interpolateColors(5, [0, 1], ['#000000', '#ffffff'])).toBe('#ffffff')
  })

  it('emits an alpha channel only when a stop is translucent', () => {
    expect(interpolateColors(0.5, [0, 1], ['#ff0000', '#0000ff'])).toBe('#800080')
    expect(interpolateColors(0.5, [0, 1], ['#00000000', '#000000ff'])).toBe('#00000080')
  })

  it('accepts multi-stop ranges and Color objects', () => {
    expect(interpolateColors(0.5, [0, 0.5, 1], ['#ff0000', '#00ff00', '#0000ff'])).toBe('#00ff00')
    expect(
      interpolateColors(
        1,
        [0, 1],
        [
          { r: 0, g: 0, b: 0 },
          { r: 1, g: 1, b: 1 },
        ],
      ),
    ).toBe('#ffffff')
  })
})
