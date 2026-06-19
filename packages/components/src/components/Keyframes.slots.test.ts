import { describe, expect, it } from 'vitest'
import type { Theme } from '../theme.js'
import { resolveColor, slotValue } from './Keyframes.js'

// Minimal theme — resolveColor only reads token keys off it.
const theme = { accent: '#7c3aed', text: '#ffffff', surface: '#08080a' } as unknown as Theme

describe('Keyframes slot binding', () => {
  it('passes a bare literal through unchanged', () => {
    expect(slotValue('#fb6514')).toBe('#fb6514')
    expect(slotValue(undefined)).toBeUndefined()
  })

  it('renders the default when the slot is unset (byte-identical conversion)', () => {
    expect(slotValue({ slot: 'brandAccent', default: '#fb6514' })).toBe('#fb6514')
  })

  it('lets `value` override the default', () => {
    expect(slotValue({ slot: 'brandAccent', default: '#fb6514', value: '#00ff00' })).toBe('#00ff00')
  })

  it('a slot-bound color with a default resolves identically to the bare literal', () => {
    expect(resolveColor({ slot: 'a', default: '#fb6514' }, theme)).toBe(
      resolveColor('#fb6514', theme),
    )
  })

  it('a brand-token slot value recolors through the theme', () => {
    expect(resolveColor({ slot: 'a', default: 'accent' }, theme)).toBe('#7c3aed')
  })

  it('a custom (non-token) hex slot value stays literal — NOT constrained to brand', () => {
    // The whole point: a user can pick any colour, not just a brand token.
    expect(resolveColor({ slot: 'a', default: 'accent', value: '#123456' }, theme)).toBe('#123456')
  })

  it('works for number slots (cornerRadius / fontWeight), and 0 overrides cleanly', () => {
    expect(slotValue<number>(24)).toBe(24)
    expect(slotValue({ slot: 'radius', default: 16 })).toBe(16)
    // value:0 must win over default:16 — proves `value ?? default`, not `value || default`.
    expect(slotValue({ slot: 'radius', default: 16, value: 0 })).toBe(0)
  })
})
