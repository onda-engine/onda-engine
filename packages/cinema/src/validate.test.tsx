//! The agent-grade linter: the fix-it feedback an MCP agent self-corrects against.

import { COMPONENT_FIDELITY } from '@onda/components'
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

  // The catalog currently has zero components in these states (everything was
  // upgraded to first_class) — pick one dynamically and skip when none exists,
  // so the linter branches stay covered if a component is ever reclassified.
  const byFidelity = (f: string) =>
    Object.entries(COMPONENT_FIDELITY).find(([, v]) => v.fidelity === f)?.[0]
  const apes = byFidelity('apes_remotion')
  const degraded = byFidelity('degraded')

  it.skipIf(!apes)('warns an apes_remotion component renders an approximation', () => {
    const d = validateComposition(comp([entry({ component: apes as string })]))
    expect(d.some((x) => x.level === 'warning' && /imitates a browser-only/.test(x.message))).toBe(
      true,
    )
  })

  it('warns a GPU-only component will not render on the CPU reference', () => {
    const d = validateComposition(comp([entry({ component: 'GradientShift' })]))
    expect(d.some((x) => x.level === 'warning' && /needs the GPU/.test(x.message))).toBe(true)
  })

  it.skipIf(!degraded)('infos a degraded component (with its needed feature)', () => {
    const d = validateComposition(comp([entry({ component: degraded as string })]))
    expect(
      d.some((x) => x.level === 'info' && /renders an approximation until/.test(x.message)),
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
