import { describe, expect, it } from 'vitest'
import {
  entryDesignAnchor,
  isFullBleed,
  responsiveCoverTransform,
  responsiveEntryTransform,
} from './responsive.js'

const DESIGN = { width: 1600, height: 1200 }

describe('entryDesignAnchor', () => {
  it('is null for an element with no absolute position (it self-places)', () => {
    expect(entryDesignAnchor({ content: { kind: 'text', text: 'Hi' } })).toBeNull()
    expect(entryDesignAnchor(undefined)).toBeNull()
  })

  it('is the mean of the position track', () => {
    const a = entryDesignAnchor({
      position: [
        { at: 0, x: 100, y: 200 },
        { at: 30, x: 300, y: 400 },
      ],
    })
    expect(a).toEqual({ x: 200, y: 300 })
  })

  it('shifts an image anchor from its corner pivot to the tile visual centre', () => {
    // A 1000×1000 tile pivoted at its TOP-LEFT (0,0), scaled 0.5 ⇒ visual centre is
    // +250,+250 from the position.
    const a = entryDesignAnchor({
      position: [{ at: 0, x: 100, y: 100 }],
      scale: [{ at: 0, v: 0.5 }],
      content: { kind: 'image', width: 1000, height: 1000, anchorX: 0, anchorY: 0 },
    })
    expect(a).toEqual({ x: 350, y: 350 })
  })
})

describe('responsiveEntryTransform', () => {
  it('is identity when the canvas already matches (or anchor is null)', () => {
    expect(responsiveEntryTransform({ x: 800, y: 600 }, DESIGN, DESIGN)).toEqual({
      x: 0,
      y: 0,
      scale: 1,
    })
    expect(responsiveEntryTransform(null, DESIGN, { width: 1080, height: 1920 })).toEqual({
      x: 0,
      y: 0,
      scale: 1,
    })
  })

  it('keeps a centred element centred and uniformly scaled (min axis ratio)', () => {
    // 4:3 → 9:16: s = min(1080/1600, 1920/1200) = 0.675. A dead-centre anchor stays
    // dead-centre on the output.
    const out = { width: 1080, height: 1920 }
    const t = responsiveEntryTransform({ x: 800, y: 600 }, DESIGN, out)
    expect(t.scale).toBeCloseTo(0.675, 5)
    // The design centre (800,600) must land on the output centre (540,960).
    expect(t.x + 800 * t.scale).toBeCloseTo(540, 4)
    expect(t.y + 600 * t.scale).toBeCloseTo(960, 4)
  })

  it('pins a top-left element to the top-left corner of any frame', () => {
    // An anchor in the outer fifth hugs the near edge, keeping a scaled gap.
    const out = { width: 1080, height: 1920 }
    const t = responsiveEntryTransform({ x: 80, y: 60 }, DESIGN, out)
    const s = Math.min(1080 / 1600, 1920 / 1200)
    // Anchor lands at (80*s, 60*s) — a small scaled gap from the top-left.
    expect(t.x + 80 * s).toBeCloseTo(80 * s, 4)
    expect(t.y + 60 * s).toBeCloseTo(60 * s, 4)
  })

  it('pins a bottom-right element to the far corner', () => {
    const out = { width: 1080, height: 1920 }
    const s = Math.min(1080 / 1600, 1920 / 1200)
    const t = responsiveEntryTransform({ x: 1520, y: 1140 }, DESIGN, out)
    // Gap from the far edges (1600-1520=80, 1200-1140=60) is preserved, scaled.
    expect(t.x + 1520 * t.scale).toBeCloseTo(1080 - 80 * s, 4)
    expect(t.y + 1140 * t.scale).toBeCloseTo(1920 - 60 * s, 4)
  })
})

describe('isFullBleed', () => {
  it('flags an image/video plate that covers (≈) the whole design canvas', () => {
    expect(isFullBleed({ content: { kind: 'image', width: 1600, height: 1200 } }, DESIGN)).toBe(
      true,
    )
    expect(isFullBleed({ content: { kind: 'video', width: 1600, height: 1200 } }, DESIGN)).toBe(
      true,
    )
    // A half-size content scaled 2× still covers the canvas.
    expect(
      isFullBleed(
        { content: { kind: 'image', width: 800, height: 600 }, scale: [{ at: 0, v: 2 }] },
        DESIGN,
      ),
    ).toBe(true)
  })

  it('does NOT flag small tiles, text, or content covering only one axis', () => {
    expect(isFullBleed({ content: { kind: 'image', width: 400, height: 300 } }, DESIGN)).toBe(false)
    expect(isFullBleed({ content: { kind: 'text', text: 'Hi' } }, DESIGN)).toBe(false)
    // Wide banner: covers the width but not the height → not full-bleed.
    expect(isFullBleed({ content: { kind: 'image', width: 1600, height: 200 } }, DESIGN)).toBe(
      false,
    )
    expect(isFullBleed(undefined, DESIGN)).toBe(false)
  })
})

describe('responsiveCoverTransform', () => {
  it('is identity when the canvas already matches', () => {
    expect(responsiveCoverTransform(DESIGN, DESIGN)).toEqual({ x: 0, y: 0, scale: 1 })
  })

  it('scales a background by the LARGER axis ratio (cover) and centres it — no dead space', () => {
    // 4:3 (1600×1200) → 9:16 (1080×1920). FIT would use min ratio (0.675) and leave the plate
    // as a 1080×810 band with 555px of dead space top+bottom. COVER uses the max ratio so the
    // plate fills the full 1920 height (overflowing the width instead).
    const out = { width: 1080, height: 1920 }
    const s = Math.max(1080 / 1600, 1920 / 1200) // = 1.6
    const t = responsiveCoverTransform(DESIGN, out)
    expect(t.scale).toBeCloseTo(s, 5)
    // The scaled plate covers BOTH axes (≥ output on each).
    expect(DESIGN.width * t.scale).toBeGreaterThanOrEqual(out.width - 1e-6)
    expect(DESIGN.height * t.scale).toBeGreaterThanOrEqual(out.height - 1e-6)
    // The design canvas centre lands on the output centre.
    expect(t.x + (DESIGN.width / 2) * t.scale).toBeCloseTo(out.width / 2, 4)
    expect(t.y + (DESIGN.height / 2) * t.scale).toBeCloseTo(out.height / 2, 4)
  })
})
