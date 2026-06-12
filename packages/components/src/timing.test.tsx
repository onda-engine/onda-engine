import { Composition, type Scene, Sequence, renderFrame } from '@onda/react'
import { createElement as h } from 'react'
import { describe, expect, it } from 'vitest'
import { KineticText } from './components/KineticText.js'
import { SlotMachineRoll } from './components/SlotMachineRoll.js'
import { DURATION, STAGGER } from './motion.js'
import { framesOf } from './time.js'
import { settleTime, staggeredSettle } from './timing.js'

describe('framesOf', () => {
  it('passes numbers through as frames', () => {
    expect(framesOf(12, 30)).toBe(12)
    expect(framesOf(undefined, 30, 7)).toBe(7)
  })
  it('parses the cinema time grammar', () => {
    expect(framesOf('0.5s', 30)).toBe(15)
    expect(framesOf('500ms', 30)).toBe(15)
    expect(framesOf('12f', 30)).toBe(12)
    expect(framesOf('1:30', 30)).toBe(90 * 30)
    expect(framesOf('', 30, 9)).toBe(9)
  })
})

describe('settleTime registry', () => {
  it('computes the slot-roll settle (the 1.4s-beat field case)', () => {
    // 4 chars: delay 0 + 3×STAGGER(5) + DURATION.slower(34) + glow tail (22−8)
    const settle = settleTime('SlotMachineRoll', { text: '2026' }, 30)
    expect(settle).toBe(staggeredSettle(4, STAGGER, DURATION.slower) + (DURATION.base - 8))
    // …which indeed does NOT land inside a 1.4s (42-frame) beat:
    expect(settle ?? 0).toBeGreaterThan(42)
  })
  it('accepts time strings in props', () => {
    expect(settleTime('FadeIn', { delay: '0.5s', durationInFrames: '10f' }, 30)).toBe(25)
  })
  it('returns null for unregistered components', () => {
    expect(settleTime('Vignette')).toBeNull()
  })
  it('covers the per-glyph family + the common entrances', () => {
    for (const name of [
      'SlotMachineRoll',
      'MatrixDecode',
      'KineticText',
      'TextAnimator',
      'Typewriter',
      'CountUp',
      'FadeIn',
      'SlideIn',
      'TitleCard',
      'StatCard',
      'Terminal',
      'LowerThird',
      'Button',
    ]) {
      expect(settleTime(name), name).not.toBeNull()
    }
  })
})

// ── fitToClip: the slot-roll actually lands inside a short beat ──────────────

function renderClip(element: React.ReactElement, clipFrames: number, frame: number): Scene {
  const comp = h(
    Composition,
    { width: 1920, height: 1080, fps: 30, durationInFrames: 120 },
    h(Sequence, { from: 0, durationInFrames: clipFrames }, element),
  )
  return renderFrame(comp, frame)
}

/** The most negative translate-y in the scene — the reel translation. */
function minTranslateY(node: unknown, acc = { min: 0 }): number {
  const walk = (n: unknown) => {
    if (n == null || typeof n !== 'object') return
    const o = n as {
      transform?: { translate?: { y?: number } }
      children?: unknown[]
      root?: unknown
    }
    const ty = o.transform?.translate?.y
    if (typeof ty === 'number' && ty < acc.min) acc.min = ty
    if (Array.isArray(o.children)) for (const k of o.children) walk(k)
    if (o.root) walk(o.root)
  }
  walk(node)
  return acc.min
}

describe('fitToClip', () => {
  it('compresses the slot-roll to settle inside a short clip', () => {
    const clip = 30 // a one-second beat the default 63-frame settle overshoots
    const judge = clip - 6 // the default hold: must be settled here
    const reelTravel = -12 * 140 // reelLength × fontSize — the settled translate
    const free = minTranslateY(renderClip(h(SlotMachineRoll, { text: '2026' }), clip, judge))
    const fitted = minTranslateY(
      renderClip(h(SlotMachineRoll, { text: '2026', fitToClip: true }), clip, judge),
    )
    // Unfitted: the last reel is still visibly short of landed at the judge
    // frame (the deterministic spring sits ~40px off the target).
    expect(Math.abs(free - reelTravel)).toBeGreaterThan(30)
    // Fitted: every reel has (within the spring's rest threshold) landed.
    expect(Math.abs(fitted - reelTravel)).toBeLessThan(15)
    expect(Math.abs(fitted - reelTravel)).toBeLessThan(Math.abs(free - reelTravel) / 2)
  })

  it('maxSettle wins over fitToClip and accepts time strings', () => {
    const a = JSON.stringify(
      renderClip(h(SlotMachineRoll, { text: '2026', maxSettle: '20f' }), 120, 25),
    )
    const b = JSON.stringify(
      renderClip(h(SlotMachineRoll, { text: '2026', maxSettle: 20 }), 120, 25),
    )
    expect(a).toBe(b)
  })
})

describe('TimeInput on components', () => {
  it("KineticText delay '0.5s' === delay 15 @30fps", () => {
    const byString = JSON.stringify(renderClip(h(KineticText, { delay: '0.5s' }), 120, 30))
    const byFrames = JSON.stringify(renderClip(h(KineticText, { delay: 15 }), 120, 30))
    expect(byString).toBe(byFrames)
  })
})
