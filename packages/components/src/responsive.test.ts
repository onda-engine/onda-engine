import { describe, expect, it } from 'vitest'
import {
  entryDesignAnchor,
  gridReflowPlacements,
  isAspectFlip,
  isFullBleed,
  isHiddenForOutput,
  outputAspect,
  responsiveCoverTransform,
  responsiveEntryTransform,
  responsiveFill,
  scrollReflowPlacements,
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

describe('outputAspect', () => {
  it('buckets the output canvas by aspect', () => {
    expect(outputAspect({ width: 1920, height: 1080 })).toBe('landscape')
    expect(outputAspect({ width: 1080, height: 1920 })).toBe('portrait')
    expect(outputAspect({ width: 1080, height: 1080 })).toBe('square')
  })
})

describe('isHiddenForOutput (per-entry hideOn)', () => {
  const portrait = { width: 1080, height: 1920 }
  const landscape = { width: 1920, height: 1080 }

  it('drops the entry only on a listed output aspect', () => {
    expect(isHiddenForOutput({ hideOn: ['portrait'] }, portrait)).toBe(true)
    expect(isHiddenForOutput({ hideOn: ['portrait'] }, landscape)).toBe(false)
  })

  it('is false with no behaviour / no hideOn', () => {
    expect(isHiddenForOutput(undefined, portrait)).toBe(false)
    expect(isHiddenForOutput({ safeArea: true }, portrait)).toBe(false)
  })
})

describe('responsiveEntryTransform — per-entry behaviour', () => {
  it('clamps the fit scale to minScale (keep a caption legible in a tall frame)', () => {
    // 4:3 → 9:16 natural fit is 0.675; minScale 0.9 raises it.
    const out = { width: 1080, height: 1920 }
    const t = responsiveEntryTransform({ x: 800, y: 600 }, DESIGN, out, { minScale: 0.9 })
    expect(t.scale).toBeCloseTo(0.9, 5)
  })

  it('clamps the fit scale to maxScale (cap how big an element grows)', () => {
    // 1600×1200 → 3200×2400: natural fit = 2; maxScale 1.5 caps it.
    const out = { width: 3200, height: 2400 }
    const t = responsiveEntryTransform({ x: 800, y: 600 }, DESIGN, out, { maxScale: 1.5 })
    expect(t.scale).toBeCloseTo(1.5, 5)
  })

  it('keeps a corner-pinned anchor inside the safe area when safeArea is on', () => {
    // A (0,0) anchor pins flush to the corner (gap 0); safeArea pulls it to the 10% inset.
    const out = { width: 1080, height: 1920 }
    const t = responsiveEntryTransform({ x: 0, y: 0 }, DESIGN, out, { safeArea: true })
    expect(t.x).toBeCloseTo(0.1 * out.width, 4) // 108
    expect(t.y).toBeCloseTo(0.1 * out.height, 4) // 192
  })

  it('is unchanged from the default when no behaviour is passed', () => {
    const out = { width: 1080, height: 1920 }
    const base = responsiveEntryTransform({ x: 800, y: 600 }, DESIGN, out)
    const withEmpty = responsiveEntryTransform({ x: 800, y: 600 }, DESIGN, out, {})
    expect(withEmpty).toEqual(base)
  })

  it('byAspect override re-places the element for a matching output aspect (reflow)', () => {
    // Portrait output: place this tile's anchor at 25%/30% of the frame, scale 0.4 —
    // overriding the computed pin (the re-column primitive).
    const out = { width: 1080, height: 1920 }
    const behavior = { byAspect: { portrait: { x: 0.25, y: 0.3, scale: 0.4 } } }
    const t = responsiveEntryTransform({ x: 800, y: 600 }, DESIGN, out, behavior)
    expect(t.scale).toBeCloseTo(0.4, 5)
    // The design anchor (800,600) lands at (0.25*1080, 0.3*1920) = (270, 576).
    expect(t.x + 800 * t.scale).toBeCloseTo(270, 4)
    expect(t.y + 600 * t.scale).toBeCloseTo(576, 4)
  })

  it('byAspect override only fires for the matching aspect', () => {
    const land = { width: 1920, height: 1080 }
    const behavior = { byAspect: { portrait: { x: 0.5, y: 0.5, scale: 0.4 } } }
    // Landscape output: no portrait override → falls back to the normal reframe.
    const t = responsiveEntryTransform({ x: 800, y: 600 }, DESIGN, land, behavior)
    const base = responsiveEntryTransform({ x: 800, y: 600 }, DESIGN, land)
    expect(t).toEqual(base)
  })

  it('fill scales the base toward COVER (bigger on a flip)', () => {
    // 4:3 → 9:16: fit = 0.675, cover = 1.6. fill=0.5 → halfway = 1.1375.
    const out = { width: 1080, height: 1920 }
    const fit = Math.min(1080 / 1600, 1920 / 1200)
    const cover = Math.max(1080 / 1600, 1920 / 1200)
    const t = responsiveEntryTransform({ x: 800, y: 600 }, DESIGN, out, undefined, 0.5)
    expect(t.scale).toBeCloseTo(fit + 0.5 * (cover - fit), 5)
    // fill=0 is exactly the fit baseline.
    expect(responsiveEntryTransform({ x: 800, y: 600 }, DESIGN, out, undefined, 0).scale).toBeCloseTo(fit, 5)
  })
})

describe('gridReflowPlacements (deterministic grid reflow)', () => {
  // A 2-column portrait mosaic of 4 image tiles, plus an ambient background + a stack.
  const tile = (x: number, y: number) => ({
    role: 'support',
    props: { position: [{ at: 0, x, y }], content: { kind: 'image', width: 400, height: 400 } },
  })
  const port = { width: 1080, height: 1920 }
  const land = { width: 1920, height: 1080 }

  it('re-columns content tiles into a grid on a flip', () => {
    const entries = [
      { role: 'ambient', props: { position: [{ at: 0, x: 540, y: 960 }], content: { kind: 'image', width: 1080, height: 1920 } } }, // full-bleed bg
      tile(283, 270),
      tile(283, 722),
      tile(797, 336),
      tile(797, 936),
    ]
    const out = gridReflowPlacements(entries, port, land)
    expect(out[0]).toBeNull() // ambient full-bleed bg is not a tile
    const placed = out.slice(1)
    expect(placed.every((p) => p !== null)).toBe(true)
    // 4 tiles into a landscape grid → 2 cols; distinct x centres across the width.
    const xs = new Set(placed.map((p) => p?.x))
    expect(xs.size).toBeGreaterThan(1)
  })

  it('is a no-op on a same-orientation reframe (preserves the authored layout)', () => {
    const entries = [tile(283, 270), tile(797, 936)]
    expect(gridReflowPlacements(entries, port, { width: 1080, height: 1350 })).toEqual([null, null])
  })

  it('bails on a heterogeneous set (hero + icon + pill) — not a real grid', () => {
    const big = { role: 'support', props: { position: [{ at: 0, x: 200, y: 300 }], content: { kind: 'image', width: 620, height: 620 } } }
    const mid = { role: 'support', props: { position: [{ at: 0, x: 500, y: 700 }], content: { kind: 'image', width: 410, height: 410 } } }
    const pill = { role: 'support', props: { position: [{ at: 0, x: 300, y: 1100 }], content: { kind: 'image', width: 360, height: 108 } } }
    const out = gridReflowPlacements([big, mid, pill], port, land)
    expect(out).toEqual([null, null, null]) // too varied → fall back to per-element reframe
  })

  it('excludes a stack of entries sharing one anchor (e.g. a spotlight sequence)', () => {
    const entries = [tile(283, 270), tile(797, 936), tile(540, 860), tile(540, 860), tile(540, 860)]
    const out = gridReflowPlacements(entries, port, land)
    expect(out[0]).not.toBeNull()
    expect(out[1]).not.toBeNull()
    expect(out[2]).toBeNull() // the 3 co-located tiles are a stack, not grid cells
    expect(out[3]).toBeNull()
    expect(out[4]).toBeNull()
  })
})

describe('scrollReflowPlacements (uniform scroll re-centre)', () => {
  const design = { width: 1080, height: 1350 } // 4:5
  const out = { width: 1080, height: 1920 } // 9:16
  // A vertical word that sweeps the full frame (a scroller), anchored left.
  const word = (y0: number, y1: number) => ({
    role: "support",
    props: { position: [{ at: 0, x: 60, y: y0 }, { at: 30, x: 60, y: y1 }], content: { kind: "text", text: "WORD", fontSize: 215 } },
  })

  it('shifts every scroller word by the SAME amount (keeps spacing, re-centres)', () => {
    const a = word(905, -565); // mean ~170
    const b = word(1115, -355); // mean ~380  (210 below a)
    const out2 = scrollReflowPlacements([a, b], design, out)
    const shift = out.height / 2 - design.height / 2; // 285
    expect(out2[0]?.y).toBeCloseTo((170 + shift) / out.height, 5)
    expect(out2[1]?.y).toBeCloseTo((380 + shift) / out.height, 5)
    // The 210px design gap is preserved in output px → spacing intact.
    expect((out2[1]!.y - out2[0]!.y) * out.height).toBeCloseTo(210, 4)
  })

  it('leaves static / full-bleed / ambient entries alone', () => {
    const staticText = { role: "support", props: { position: [{ at: 0, x: 540, y: 675 }], content: { kind: "text", text: "Hi" } } }
    const bg = { role: "ambient", props: { position: [{ at: 0, x: 540, y: 675 }], content: { kind: "image", width: 1080, height: 1350 } } }
    const out2 = scrollReflowPlacements([staticText, bg, word(905, -565)], design, out)
    expect(out2[0]).toBeNull() // static (no sweep)
    expect(out2[1]).toBeNull() // ambient full-bleed bg
    expect(out2[2]).not.toBeNull() // the scroller word
  })
})

describe('isAspectFlip / responsiveFill', () => {
  const land = { width: 1920, height: 1080 }
  const port = { width: 1080, height: 1920 }

  it('detects orientation flips only', () => {
    expect(isAspectFlip(land, port)).toBe(true)
    expect(isAspectFlip(port, land)).toBe(true)
    expect(isAspectFlip(land, { width: 1440, height: 1080 })).toBe(false) // both landscape
    expect(isAspectFlip(land, { width: 1080, height: 1080 })).toBe(false) // → square
  })

  it('defaults to a fill on a flip, 0 on same-orientation, and honours an explicit value', () => {
    expect(responsiveFill(undefined, land, port)).toBeGreaterThan(0) // flip → auto-fill
    expect(responsiveFill(undefined, land, { width: 1440, height: 1080 })).toBe(0) // no flip
    expect(responsiveFill(0, land, port)).toBe(0) // explicit 0 overrides the flip default
    expect(responsiveFill(1, land, { width: 1440, height: 1080 })).toBe(1) // explicit wins
    expect(responsiveFill(5, land, port)).toBe(1) // clamped to [0,1]
  })
})
