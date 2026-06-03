//! The agent-grade linter: the fix-it feedback an MCP agent self-corrects against.

import { describe, expect, it } from 'vitest'
import { validateComposition } from './index.js'
import type { CompositionPayload, Entry } from './types.js'

const comp = (entries: Entry[]): CompositionPayload => ({
  fps: 30,
  width: 1920,
  height: 1080,
  scenes: [{ id: 's1', for: '4s', tracks: [{ entries }] }],
})
const entry = (e: Partial<Entry> & { component: string }): Entry => ({ at: 0, for: '4s', ...e })

describe('validateComposition — agent linter', () => {
  it('flags an unknown component with a did-you-mean', () => {
    const d = validateComposition(comp([entry({ component: 'Titlecard' })]))
    const e = d.find((x) => x.level === 'error' && /unknown component/.test(x.message))
    expect(e?.message).toMatch(/did you mean "TitleCard"/)
  })

  it('warns an apes_remotion component renders an approximation', () => {
    const d = validateComposition(comp([entry({ component: 'GrainOverlay' })]))
    expect(d.some((x) => x.level === 'warning' && /imitates a browser-only/.test(x.message))).toBe(
      true,
    )
  })

  it('warns a GPU-only component will not render on the CPU reference', () => {
    const d = validateComposition(comp([entry({ component: 'GradientShift' })]))
    expect(d.some((x) => x.level === 'warning' && /needs the GPU/.test(x.message))).toBe(true)
  })

  it('infos a degraded component (with its needed feature)', () => {
    const d = validateComposition(comp([entry({ component: 'GradientShift' })]))
    expect(
      d.some((x) => x.level === 'info' && /approximation until.*"gradients"/.test(x.message)),
    ).toBe(true)
  })

  it('errors on malformed timing', () => {
    const d = validateComposition(comp([entry({ component: 'TitleCard', for: 'soon' })]))
    expect(d.some((x) => x.level === 'error' && x.path.endsWith('.for'))).toBe(true)
  })

  it('is clean (no errors/warnings) for a first-class component', () => {
    const d = validateComposition(comp([entry({ component: 'TitleCard' })]))
    expect(d.filter((x) => x.level !== 'info')).toEqual([])
  })
})
