import { clearRegisteredFonts, registeredFonts } from '@onda-engine/react'
import { afterEach, describe, expect, it } from 'vitest'
import { glyphLayout, loadFont } from './text-metrics.js'

// G4 — custom-font author-time↔render parity.
//
// vitest's transform env does NOT warm the real wasm engine (production warms it
// via @onda-engine/render's engine-warmer, in the browser and in the Node export bake).
// So these lock only the GRACEFUL CONTRACT that holds when the engine is cold:
// loadFont / glyphLayout never throw and degrade to the estimate, so a custom
// font never breaks a composition.
//
// The REAL behavior — measurement actually changes after loadFont, matching the
// render for a non-bundled font — is proven against the production Node warming
// path (a before/after width delta for the Spectral serif). See
// techspecs/text-animators.md (G4) for the verification.
describe('loadFont — graceful contract (engine cold)', () => {
  it('is exported, async, and resolves to a string[] without throwing on bad bytes', async () => {
    const families = await loadFont(new Uint8Array([0, 1, 2, 3])) // not a valid font
    expect(Array.isArray(families)).toBe(true) // [] when the engine is unavailable
  })

  it('glyphLayout never crashes a composition for an unknown family', () => {
    const g = glyphLayout('hi', 48, { fontFamily: 'A Font Not Loaded' })
    expect(g.length).toBeGreaterThan(0) // estimate fallback keeps the line usable
  })
})

describe('loadFont — single-source registry (render harness pickup)', () => {
  afterEach(() => clearRegisteredFonts())

  it('retains the bytes for @onda-engine/render even when the engine is cold', async () => {
    // registerFont runs synchronously inside loadFont (before the async engine
    // load), so the render harness gets the font regardless of warmth.
    clearRegisteredFonts()
    await loadFont(new Uint8Array([0, 1, 2, 3, 4, 5]))
    expect(registeredFonts()).toHaveLength(1)
  })
})
