import { Composition, renderFrame } from '@onda/react'
import { createElement as h } from 'react'
import { describe, expect, it } from 'vitest'
import { Button } from './components/Button.js'
import { SlotMachineRoll } from './components/SlotMachineRoll.js'
import { StatCard } from './components/StatCard.js'
import { PLACEMENT_REGIONS, resolvePlacement } from './placement.js'

const FRAME = { width: 1920, height: 1080 }

describe('resolvePlacement', () => {
  it('defaults to the canvas center', () => {
    const r = resolvePlacement(undefined, FRAME)
    expect(r.x).toBe(960)
    expect(r.y).toBe(540)
    expect(r.dx).toBe(0)
    expect(r.dy).toBe(0)
  })

  it('anchors a normalized point at the element center', () => {
    const r = resolvePlacement({ x: 0.25, y: 0.75 }, FRAME, { width: 200, height: 100 })
    expect(r.x).toBe(480)
    expect(r.y).toBe(810)
    expect(r.originX).toBe(380) // x - width/2
    expect(r.originY).toBe(760)
  })

  it('treats omitted point axes as centered', () => {
    const r = resolvePlacement({ y: 0.72 }, FRAME)
    expect(r.x).toBe(960)
    expect(r.y).toBeCloseTo(0.72 * 1080)
  })

  it('matches the cinema bridge fractions for center/thirds', () => {
    expect(resolvePlacement('lower-third', FRAME).y).toBeCloseTo(0.72 * 1080)
    expect(resolvePlacement('upper-third', FRAME).y).toBeCloseTo(0.28 * 1080)
    expect(PLACEMENT_REGIONS['lower-third']).toEqual([0.5, 0.72])
  })

  it('flushes corner regions onto the safe margin when the size is known', () => {
    const r = resolvePlacement('top-left', FRAME, { width: 400, height: 200 })
    expect(r.originX).toBeCloseTo(0.1 * 1920) // left edge ON the margin
    expect(r.originY).toBeCloseTo(0.1 * 1080) // top edge ON the margin
    const br = resolvePlacement('bottom-right', FRAME, { width: 400, height: 200 })
    expect(br.originX + 400).toBeCloseTo(0.9 * 1920) // right edge ON the margin
    expect(br.originY + 200).toBeCloseTo(0.9 * 1080)
  })

  it('falls back to center-anchoring corners when the size is unknown', () => {
    const r = resolvePlacement('top-left', FRAME)
    expect(r.x).toBeCloseTo(0.1 * 1920)
    expect(r.y).toBeCloseTo(0.1 * 1080)
  })
})

// Scene-level checks: placement actually moves the rendered nodes, and the
// default stays byte-stable (the compatibility contract).
function renderScene(element: React.ReactElement, frame = 20) {
  const comp = h(Composition, { width: 1920, height: 1080, fps: 30, durationInFrames: 60 }, element)
  return renderFrame(comp, frame)
}

describe('placement prop on components', () => {
  it('SlotMachineRoll honors placement and legacy y keeps working', () => {
    const centered = JSON.stringify(renderScene(h(SlotMachineRoll, { text: '42' })))
    const placed = JSON.stringify(
      renderScene(h(SlotMachineRoll, { text: '42', placement: 'lower-third' })),
    )
    const legacy = JSON.stringify(renderScene(h(SlotMachineRoll, { text: '42', y: 100 })))
    expect(placed).not.toBe(centered)
    expect(legacy).not.toBe(centered)
  })

  it('Button placement defaults to center (legacy centerX/centerY equivalence)', () => {
    const byDefault = JSON.stringify(renderScene(h(Button, {})))
    const byLegacy = JSON.stringify(renderScene(h(Button, { centerX: 0.5, centerY: 0.5 })))
    const byPlacement = JSON.stringify(renderScene(h(Button, { placement: 'center' })))
    expect(byLegacy).toBe(byDefault)
    expect(byPlacement).toBe(byDefault)
    const moved = JSON.stringify(renderScene(h(Button, { placement: { x: 0.2, y: 0.8 } })))
    expect(moved).not.toBe(byDefault)
  })

  it('StatCard default render is unchanged by the placement wrapper', () => {
    const before = JSON.stringify(renderScene(h(StatCard, { value: '100x', label: 'faster' })))
    const explicitCenter = JSON.stringify(
      renderScene(h(StatCard, { value: '100x', label: 'faster', placement: 'center' })),
    )
    expect(explicitCenter).toBe(before)
    const shifted = JSON.stringify(
      renderScene(h(StatCard, { value: '100x', label: 'faster', placement: 'upper-third' })),
    )
    expect(shifted).not.toBe(before)
  })
})
