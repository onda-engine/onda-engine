//! The inspector's regression suite — every documented field failure as a
//! fixture, plus the false-positive guard: a clean composition must produce
//! ZERO violations (an inspector that cries wolf trains the agent to ignore it).

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { preloadTextMetrics } from '@onda-engine/components'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CompositionPayload, Entry } from '../types.js'
import { inspect } from './index.js'

beforeAll(async () => {
  // Real cosmic-text widths when the workspace wasm is present (vitest's SSR
  // lacks import.meta.resolve, so point ONDA_WASM_PATH at it directly); the
  // glyph-count estimate otherwise — every assertion below holds under both.
  if (!process.env.ONDA_WASM_PATH) {
    const wasm = fileURLToPath(new URL('../../../wasm/pkg/onda_wasm_bg.wasm', import.meta.url))
    if (existsSync(wasm)) process.env.ONDA_WASM_PATH = wasm
  }
  await preloadTextMetrics()
})

const LANDSCAPE = { fps: 30, width: 1920, height: 1080 }
const PORTRAIT = { fps: 30, width: 1080, height: 1920 }

const scene = (
  id: string,
  dur: string,
  entries: Entry[],
  transition?: { type: string; durationInFrames?: number },
) => ({
  id,
  for: dur,
  ...(transition ? { transition } : {}),
  tracks: [{ entries }],
})

describe('inspect — field-failure fixtures', () => {
  it('flags the over-long headline ("WEEKS OF WORK" at 140px on 9:16)', () => {
    const report = inspect({
      ...PORTRAIT,
      scenes: [
        scene('s1', '2s', [
          {
            at: 0,
            for: '2s',
            id: 'headline',
            component: 'TitleCard',
            props: { title: 'WEEKS OF WORK', titleSize: 140 },
          },
        ]),
      ],
    })
    const overflow = report.violations.filter((v) => v.check === 'layout.overflow')
    expect(overflow.length).toBeGreaterThan(0)
    expect(overflow[0]?.targetId).toBe('headline')
    // The fix is mechanical: a fitted font size, smaller than the original.
    const withFix = overflow.find((v) => v.fix)
    expect(withFix?.fix?.prop).toBe('titleSize')
    expect(withFix?.fix?.suggested).toBeLessThan(140)
  })

  it('suggests an overflow fix that CONVERGES in one pass (no shrink-loop)', () => {
    // Regression: a CENTERED wide line under 9:16's ASYMMETRIC safe margins.
    // The fix used to target the full safe-area WIDTH, but a centered box bumps
    // the nearer edge first — so the "fix" still overflowed and the agent
    // shrank in tiny steps forever. Applying the suggestion must clear it ONCE.
    const comp = (fontSize: number): CompositionPayload => ({
      ...PORTRAIT,
      scenes: [
        scene('s1', '2s', [
          {
            at: 0,
            for: '2s',
            id: 'name',
            component: 'TrackingIn',
            props: { text: 'THE BIG NAME', fontSize, letterSpacing: 16 },
          },
        ]),
      ],
    })
    const flagged = inspect(comp(240)).violations.find(
      (v) => v.check === 'layout.overflow' && v.targetId === 'name' && v.fix,
    )
    expect(flagged?.fix?.prop).toBe('fontSize')
    const suggested = flagged?.fix?.suggested as number
    expect(suggested).toBeGreaterThan(0)
    expect(suggested).toBeLessThan(240)
    // The suggested size must actually fit — zero overflow on the next pass.
    const afterFix = inspect(comp(suggested)).violations.filter(
      (v) => v.check === 'layout.overflow' && v.targetId === 'name',
    )
    expect(afterFix).toHaveLength(0)
  })

  it('flags a slot-roll whose settle exceeds a 1.4s scene (cut collision)', () => {
    const report = inspect({
      ...LANDSCAPE,
      scenes: [
        scene('s1', '1.4s', [
          { at: 0, for: '1.4s', id: 'roll', component: 'SlotMachineRoll', props: { text: '2026' } },
        ]),
      ],
    })
    const hit = report.violations.find(
      (v) => v.check === 'timing.collisions' && v.targetId === 'roll',
    )
    expect(hit).toBeDefined()
    expect(hit?.message).toMatch(/settles at .* on screen for/)
    // SlotMachineRoll carries the fitToClip clamp — the mechanical fix.
    expect(hit?.fix).toEqual({ prop: 'fitToClip', suggested: true })
    // The reel's `charset` glyph pool is NOT rendered prose — never measured.
    expect(report.violations.filter((v) => v.check === 'layout.overflow')).toEqual([])
  })

  it('flags two focal entries entering at the same `at`', () => {
    const report = inspect({
      ...LANDSCAPE,
      scenes: [
        scene('s1', '4s', [
          {
            at: 0,
            for: '4s',
            id: 'a',
            role: 'focal',
            component: 'TitleCard',
            props: { title: 'Hello', titleSize: 96, placement: 'upper-third' },
          },
          {
            at: 0,
            for: '4s',
            id: 'b',
            role: 'focal',
            component: 'TitleCard',
            props: { title: 'World', titleSize: 96, placement: 'lower-third' },
          },
        ]),
      ],
    })
    const hit = report.violations.find((v) => v.check === 'timing.collisions')
    expect(hit).toBeDefined()
    expect(hit?.message).toMatch(/focal entrances collide/)
    // Two focal visible at once also blows the density focal budget.
    expect(
      report.violations.some((v) => v.check === 'density.score' && /focal/.test(v.message)),
    ).toBe(true)
  })

  it('flags an over-dense scene (6 concurrent non-ambient entries)', () => {
    const entries: Entry[] = Array.from({ length: 6 }, (_, i) => ({
      at: 0,
      for: '4s',
      id: `e${i}`,
      component: 'TitleCard',
      props: { title: `Word${i}`, titleSize: 96 },
    }))
    const report = inspect({ ...LANDSCAPE, scenes: [scene('busy', '4s', entries)] })
    const hit = report.violations.find((v) => v.check === 'density.score')
    expect(hit).toBeDefined()
    expect(hit?.message).toMatch(/6 concurrently visible/)
    expect(report.density[0]).toMatchObject({ sceneId: 'busy', peakNonAmbient: 6 })
  })

  it('flags text shown for less than its reading time', () => {
    const report = inspect({
      ...LANDSCAPE,
      scenes: [
        scene('s1', '4s', [
          {
            at: 0,
            for: '1s',
            id: 'rushed',
            component: 'TitleCard',
            props: { title: 'The quick brown fox jumps over the lazy dog', titleSize: 40 },
          },
        ]),
      ],
    })
    const hit = report.violations.find((v) => v.check === 'timing.readingTime')
    expect(hit).toBeDefined()
    expect(hit?.targetId).toBe('rushed')
    // 9 words → max(1.2, 0.25×9 + 0.6) = 2.85s, rounded up to the next 0.1s.
    expect(hit?.fix).toEqual({ prop: 'for', suggested: '2.9s' })
  })

  it('flags low-contrast text on a solid background (WCAG 1.4.3)', () => {
    const report = inspect({
      ...LANDSCAPE,
      brand: { bg: '#222222' },
      scenes: [
        scene('s1', '4s', [
          {
            at: 0,
            for: '4s',
            id: 'ghost',
            component: 'TitleCard',
            props: { title: 'Read me', titleSize: 96, titleColor: '#333333' },
          },
        ]),
      ],
    })
    const hit = report.violations.find(
      (v) => v.check === 'text.legibility' && v.severity === 'error',
    )
    expect(hit).toBeDefined()
    expect(hit?.targetId).toBe('ghost')
    expect(hit?.message).toMatch(/contrast is .* below the WCAG 3:1/)
  })

  it('reports media behind text as analytically unverifiable (info, not a guess)', () => {
    const report = inspect({
      ...LANDSCAPE,
      scenes: [
        {
          id: 's1',
          for: '4s',
          tracks: [
            {
              entries: [
                {
                  at: 0,
                  for: '4s',
                  id: 'photo',
                  component: 'KenBurns',
                  props: { src: 'https://example.com/p.jpg' },
                },
              ],
            },
            {
              entries: [
                {
                  at: 0,
                  for: '4s',
                  id: 'caption',
                  component: 'TitleCard',
                  props: { title: 'Over media', titleSize: 96 },
                },
              ],
            },
          ],
        },
      ],
    })
    const hit = report.violations.find(
      (v) => v.check === 'text.legibility' && v.targetId === 'caption',
    )
    expect(hit?.severity).toBe('info')
    expect(hit?.message).toMatch(/unverifiable analytically/)
  })

  it('flags a thumbnail frame inside a transition window (and the over-budget transition)', () => {
    const payload: CompositionPayload = {
      ...LANDSCAPE,
      scenes: [
        scene('s1', '4s', [
          {
            at: 0,
            for: '4s',
            id: 'a',
            component: 'TitleCard',
            props: { title: 'One', titleSize: 96 },
          },
        ]),
        scene(
          's2',
          '4s',
          [
            {
              at: 0,
              for: '4s',
              id: 'b',
              component: 'TitleCard',
              props: { title: 'Two', titleSize: 96 },
            },
          ],
          { type: 'cross-fade', durationInFrames: 30 },
        ),
      ],
    }
    // Transition window: scene 2 starts at 120−30=90 → frames 90..119.
    const report = inspect(payload, { frames: [100] })
    const capture = report.violations.find((v) => v.check === 'frames.transitionCapture')
    expect(capture).toBeDefined()
    expect(capture?.sceneId).toBe('s2')
    expect(capture?.fix).toEqual({ prop: 'frames', suggested: 89 }) // nearest safe frame
    // The same 30-frame (1.0s) overlap blows the 0.6s budget.
    const budget = report.violations.find(
      (v) => v.check === 'timing.collisions' && /transition/.test(v.message),
    )
    expect(budget?.fix).toEqual({ prop: 'transition.durationInFrames', suggested: 18 })
    // A frame outside the window is clean.
    const clean = inspect(payload, { frames: [60] })
    expect(clean.violations.filter((v) => v.check === 'frames.transitionCapture')).toEqual([])
  })
})

describe('inspect — false-positive guard', () => {
  it('a clean composition produces ZERO violations', () => {
    const report = inspect(
      {
        ...LANDSCAPE,
        scenes: [
          scene('clean', '4s', [
            {
              at: 0,
              for: '4s',
              id: 'title',
              role: 'focal',
              component: 'TitleCard',
              props: { title: 'Hello world', titleSize: 96 },
            },
          ]),
        ],
      },
      { frames: [60] },
    )
    expect(report.violations).toEqual([])
    expect(report.summary).toEqual({ error: 0, warn: 0, info: 0 })
    expect(report.format).toBe('16:9')
    expect(report.totalFrames).toBe(120)
    expect(report.density).toEqual([
      { sceneId: 'clean', peakNonAmbient: 1, peakFocal: 1, peakFrame: 0 },
    ])
  })

  it('infers the format from the canvas when not given', () => {
    expect(inspect({ ...PORTRAIT, scenes: [scene('s', '2s', [])] }).format).toBe('9:16')
    expect(
      inspect({ fps: 30, width: 1080, height: 1350, scenes: [scene('s', '2s', [])] }).format,
    ).toBe('4:5')
  })
})
