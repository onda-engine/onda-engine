import { describe, expect, it } from 'vitest'
import { interpolateColors, parseColor } from './color.js'

describe('parseColor', () => {
  it('parses hex (3/4/6/8-digit) and {r,g,b} objects', () => {
    expect(parseColor('#f00')).toEqual({ r: 1, g: 0, b: 0 })
    expect(parseColor('#ff0000')).toEqual({ r: 1, g: 0, b: 0 })
    expect(parseColor('#00000080').a).toBeCloseTo(0.502, 2)
    expect(parseColor({ r: 0.5, g: 0.5, b: 0.5 })).toEqual({ r: 0.5, g: 0.5, b: 0.5 })
  })

  it('maps `none` / `transparent` to a transparent color', () => {
    expect(parseColor('none')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('parses common CSS named colors (case-insensitive)', () => {
    expect(parseColor('red')).toEqual({ r: 1, g: 0, b: 0 })
    expect(parseColor('WHITE')).toEqual({ r: 1, g: 1, b: 1 })
    expect(parseColor('black')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('parses rgb()/rgba() including percentage and slash alpha', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 1, g: 0, b: 0 })
    expect(parseColor('rgba(0, 0, 0, 0.5)').a).toBeCloseTo(0.5, 5)
    expect(parseColor('rgb(0 0 0 / 50%)').a).toBeCloseTo(0.5, 5)
  })

  it('parses hsl()/hsla()', () => {
    const red = parseColor('hsl(0, 100%, 50%)')
    expect(red.r).toBeCloseTo(1, 5)
    expect(red.g).toBeCloseTo(0, 5)
    expect(red.b).toBeCloseTo(0, 5)
  })

  it('degrades unrecognized values to transparent instead of throwing', () => {
    // The whole point of the tolerant rewrite: a stray color value must NEVER crash the render.
    expect(() => parseColor('accent')).not.toThrow()
    expect(parseColor('accent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(parseColor('_theme_')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(parseColor('#zzzzzz')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    // Non-color object form (missing channels) also degrades, not throws.
    expect(parseColor({ r: 1 } as unknown as { r: number; g: number; b: number })).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    })
  })
})

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
