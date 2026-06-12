import { Composition, Group, Rect, Text, renderFrame } from '@onda/react'
import { createElement as h } from 'react'
import { describe, expect, it } from 'vitest'
import { divergenceReport, matchesExport } from './divergence.js'

function scene() {
  return renderFrame(
    h(
      Composition,
      {
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 30,
        linear: true,
        finish: { bloom: { sigma: 12 } },
      },
      h(
        Group,
        { rotation: 30, blendMode: 'screen' },
        h(Rect, { width: 100, height: 100, lightWrap: 8 }),
        h(Text, { runs: [{ text: 'hi', color: '#ff0000' }] }, 'hi'),
      ),
    ),
    0,
  )
}

describe('divergenceReport', () => {
  it('reports nothing for the export reference', () => {
    expect(divergenceReport(scene(), 'export')).toEqual([])
    expect(matchesExport(scene(), 'export')).toBe(true)
  })

  it('flags only light-wrap (+ linear) on the WebGPU preview — finish IS applied there', () => {
    const report = divergenceReport(scene(), 'preview-webgpu')
    const features = report.map((d) => d.feature).sort()
    expect(features).toEqual(['composition:linear', 'effect:light_wrap'])
    // The finish chain runs identically on native and web — must NOT be flagged.
    expect(features).not.toContain('composition:finish')
  })

  it('flags the full CPU gap set on the CPU reference', () => {
    const report = divergenceReport(scene(), 'preview-cpu')
    const features = report.map((d) => d.feature).sort()
    expect(features).toEqual([
      'composition:finish',
      'composition:linear',
      'effect:light_wrap',
      'node:blend',
      'text:runs',
      'transform:rotation',
    ])
    // native-cpu has the identical coverage (same renderer crate).
    expect(
      divergenceReport(scene(), 'native-cpu')
        .map((d) => d.feature)
        .sort(),
    ).toEqual(features)
  })

  it('reports node paths so a divergence is locatable', () => {
    const rotation = divergenceReport(scene(), 'native-cpu').find(
      (d) => d.feature === 'transform:rotation',
    )
    expect(rotation?.path).toMatch(/^root\//)
  })

  it('flags export-only motion blur on every preview when declared', () => {
    const report = divergenceReport(scene(), 'preview-webgpu', { motionBlur: true })
    expect(report.map((d) => d.feature)).toContain('composition:motionBlur')
    expect(divergenceReport(scene(), 'export', { motionBlur: true })).toEqual([])
  })
})
