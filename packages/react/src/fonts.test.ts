import { afterEach, describe, expect, it } from 'vitest'
import { clearRegisteredFonts, registerFont, registeredFonts } from './fonts.js'

afterEach(() => clearRegisteredFonts())

describe('font registry (single-source)', () => {
  it('retains registered fonts in order', () => {
    const a = new Uint8Array([1, 2, 3, 4])
    const b = new Uint8Array([5, 6, 7, 8, 9])
    registerFont(a)
    registerFont(b)
    const fonts = registeredFonts()
    expect(fonts).toHaveLength(2)
    expect(Array.from(fonts[0]!)).toEqual([1, 2, 3, 4])
    expect(Array.from(fonts[1]!)).toEqual([5, 6, 7, 8, 9])
  })

  it('dedupes the same font (by content signature)', () => {
    registerFont(new Uint8Array([10, 20, 30, 40]))
    registerFont(new Uint8Array([10, 20, 30, 40])) // identical bytes, different array
    expect(registeredFonts()).toHaveLength(1)
  })

  it('keeps distinct fonts of the same length', () => {
    registerFont(new Uint8Array([1, 2, 3, 4]))
    registerFont(new Uint8Array([1, 9, 3, 4])) // differs in a sampled byte
    expect(registeredFonts()).toHaveLength(2)
  })

  it('returns a snapshot copy (mutating it does not affect the registry)', () => {
    registerFont(new Uint8Array([1, 2, 3]))
    const snap = registeredFonts() as Uint8Array[]
    snap.push(new Uint8Array([9]))
    expect(registeredFonts()).toHaveLength(1)
  })

  it('clears the registry', () => {
    registerFont(new Uint8Array([1, 2, 3]))
    clearRegisteredFonts()
    expect(registeredFonts()).toHaveLength(0)
  })
})
