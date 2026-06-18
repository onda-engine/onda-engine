//! Regression guard for the Studio→engine prop bridge: real ONDA Studio payloads
//! use semantic SIZE ROLES (`"hero"`, `"subheading"`) and boolean `accent`, which
//! the `@onda-engine/components` ports don't take natively. `adaptProps` (in index.tsx)
//! resolves roles to canvas-aware px and aliases prop names; StatCard accepts a
//! boolean `accent`. Without these, a real payload either renders at default
//! sizes, crashes (boolean fed to `fill`), or emits NaN→`null` that the Rust f32
//! scene parser rejects. These tests lock that translation in.

import { renderFramesJSON } from '@onda-engine/react'
import { describe, expect, it } from 'vitest'
import { buildComposition } from './index.js'
import type { CompositionPayload } from './types.js'

const LANDSCAPE = { fps: 30, width: 1920, height: 1080 } // min dim 1080
// Studio's resolveSize: round(SIZE_ROLES[role] * min(w,h)). hero 0.15, subheading 0.052.
const HERO_PX = Math.round(0.15 * 1080) // 162
const SUBHEADING_PX = Math.round(0.052 * 1080) // 56

const payload: CompositionPayload = {
  ...LANDSCAPE,
  scenes: [
    {
      id: 's1',
      for: '1s',
      tracks: [
        {
          entries: [
            {
              at: 0,
              for: '1s',
              component: 'TitleCard',
              props: {
                title: 'Onda',
                subtitle: 'sub',
                titleSize: 'hero',
                subtitleSize: 'subheading',
              },
            },
          ],
        },
        {
          entries: [
            {
              at: 0,
              for: '1s',
              component: 'StatCard',
              // value: number + accent: boolean — the exact Studio contract that crashed.
              props: { value: 54, label: 'units', numberSize: 'hero', accent: true },
            },
          ],
        },
      ],
    },
  ],
}

describe('studio payload bridge (real Studio prop vocabulary)', () => {
  it('renders a token+boolean-accent payload across all frames without throwing', () => {
    expect(() => renderFramesJSON(buildComposition(payload))).not.toThrow()
  })

  it('resolves size-role tokens to Studio-exact canvas-aware px', () => {
    const json = renderFramesJSON(buildComposition(payload))
    // hero (TitleCard title + StatCard value) and subheading (subtitle) sizes.
    expect(json).toContain(`"font_size":${HERO_PX}`)
    expect(json).toContain(`"font_size":${SUBHEADING_PX}`)
  })

  it('never emits a NaN→null where a size feeds component arithmetic (gap)', () => {
    // The original failure: subtitleSize:"subheading" → Math.round("subheading"*0.8)
    // = NaN → "gap":null → Rust "invalid type: null, expected f32".
    const json = renderFramesJSON(buildComposition(payload))
    expect(json).not.toContain('"gap":null')
  })

  it('StatCard accent:true draws the rule; accent:false hides it', () => {
    const withRule = renderFramesJSON(buildComposition(payload))
    const noRule = renderFramesJSON(
      buildComposition({
        ...payload,
        scenes: [
          {
            ...payload.scenes[0],
            tracks: [
              {
                entries: [
                  {
                    at: 0,
                    for: '1s',
                    component: 'StatCard',
                    props: { value: 54, label: 'units', numberSize: 'hero', accent: false },
                  },
                ],
              },
            ],
          },
        ],
      }),
    )
    // The accent rule is a filled shape; hiding it removes shape nodes.
    const shapes = (s: string) => (s.match(/"type":"shape"/g) || []).length
    expect(shapes(withRule)).toBeGreaterThan(shapes(noRule))
  })
})
