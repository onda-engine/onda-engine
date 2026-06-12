import { Composition, type Scene, renderFrame } from '@onda/react'
import { createElement as h } from 'react'
import { describe, expect, it } from 'vitest'
import { fitFontSize, fitMaxWidth } from './bounds.js'
import { Typewriter } from './components/Typewriter.js'
import { measureText } from './text-metrics.js'

describe('fitMaxWidth', () => {
  it('returns undefined when no fit is requested', () => {
    expect(fitMaxWidth({}, 1920)).toBeUndefined()
  })
  it("caps to the frame's safe band for fit:'frame'", () => {
    expect(fitMaxWidth({ fit: 'frame' }, 1920)).toBeCloseTo(1920 * 0.8)
  })
  it('the smaller of maxWidth and the frame cap wins', () => {
    expect(fitMaxWidth({ fit: 'frame', maxWidth: 600 }, 1920)).toBe(600)
    expect(fitMaxWidth({ fit: 'frame', maxWidth: 5000 }, 1920)).toBeCloseTo(1536)
  })
})

describe('fitFontSize', () => {
  it('never scales up and leaves fitting text alone', () => {
    expect(fitFontSize('Hi', 64, 100000)).toBe(64)
  })
  it('scales down so the measured line fits the cap', () => {
    const text = 'WEEKS OF WORK INTO MINUTES'
    const base = 140
    const cap = 800
    const fitted = fitFontSize(text, base, cap)
    expect(fitted).toBeLessThan(base)
    expect(measureText(text, fitted).width).toBeLessThanOrEqual(cap)
  })
})

function renderScene(element: React.ReactElement): Scene {
  const comp = h(Composition, { width: 1920, height: 1080, fps: 30, durationInFrames: 60 }, element)
  return renderFrame(comp, 59)
}

interface FoundText {
  fontSize: number
  x: number
}

function collectTexts(node: unknown, out: FoundText[] = [], px = 0): FoundText[] {
  if (node == null || typeof node !== 'object') return out
  const n = node as {
    kind?: { type?: string; font_size?: number }
    transform?: { translate?: { x?: number } }
    children?: unknown[]
    root?: unknown
  }
  const x = px + (n.transform?.translate?.x ?? 0)
  if (n.kind?.type === 'text' && typeof n.kind.font_size === 'number') {
    out.push({ fontSize: n.kind.font_size, x })
  }
  if (Array.isArray(n.children)) for (const k of n.children) collectTexts(k, out, x)
  if (n.root) collectTexts(n.root, out, x)
  return out
}

describe("fit:'frame' on components", () => {
  it('keeps an overflowing Typewriter line inside the safe band', () => {
    const long = 'AN EXTREMELY LONG HEADLINE THAT WOULD OVERFLOW THE FRAME WIDTH'
    const unfitted = renderScene(h(Typewriter, { text: long, fontSize: 140 }))
    const fitted = renderScene(h(Typewriter, { text: long, fontSize: 140, fit: 'frame' }))
    const [u] = collectTexts(unfitted)
    const [f] = collectTexts(fitted)
    expect(u?.fontSize).toBe(140)
    expect(f?.fontSize ?? 140).toBeLessThan(140)
    // The fitted left origin is inside the safe margin band.
    expect(f?.x ?? -1).toBeGreaterThanOrEqual(1920 * 0.1 - 1)
  })
})
