// Manifest ⇄ schema integrity. The catalog's per-prop metadata (default, enum
// values, prop coverage) is DERIVED from each component's Zod schema in
// reconcileProps — these tests lock that so a hand-curated value can never drift
// from what actually renders again (the bug that had TitleCard.titleSize show 96
// while the schema/component used 120).
import { describe, expect, it } from 'vitest'
import { MANIFEST } from './manifest.js'

type ZodInternal = {
  _def?: {
    typeName?: string
    innerType?: ZodInternal
    defaultValue?: () => unknown
    values?: string[]
  }
}

/** The Zod default of a field, JSON-encoded (mirrors the manifest's unwrapZod). */
function schemaDefault(field: ZodInternal): string | undefined {
  let f: ZodInternal | undefined = field
  for (let i = 0; i < 8 && f?._def; i++) {
    const tn = f._def.typeName
    if (tn === 'ZodOptional' || tn === 'ZodNullable') {
      f = f._def.innerType
      continue
    }
    if (tn === 'ZodDefault') {
      try {
        return JSON.stringify(f._def.defaultValue?.())
      } catch {
        return undefined
      }
    }
    break
  }
  return undefined
}

/** The innermost Zod def (past optional/nullable/default wrappers). */
function innerDef(field: ZodInternal): { typeName?: string; values?: string[] } | undefined {
  let f: ZodInternal | undefined = field
  for (let i = 0; i < 8 && f?._def; i++) {
    const tn = f._def.typeName
    if (tn === 'ZodOptional' || tn === 'ZodNullable' || tn === 'ZodDefault') {
      f = f._def.innerType
      continue
    }
    break
  }
  return f?._def
}

/** Compare two default literals by value, tolerating JSON ("x") vs TS ('x'). */
function sameDefault(a: string | undefined, b: string | undefined): boolean {
  const norm = (s: string | undefined) => {
    if (s == null) return undefined
    try {
      return JSON.stringify(JSON.parse(s))
    } catch {
      /* not JSON */
    }
    try {
      return JSON.stringify(JSON.parse(s.replace(/^'(.*)'$/, '"$1"')))
    } catch {
      /* not a quoted literal */
    }
    return s
  }
  return norm(a) === norm(b)
}

function shapeOf(e: (typeof MANIFEST)[number]): Record<string, ZodInternal> | undefined {
  return (e.schema as unknown as { shape?: Record<string, ZodInternal> }).shape
}

describe('manifest ⇄ schema integrity', () => {
  it('every prop default matches its Zod schema default (no drift)', () => {
    const drift: string[] = []
    for (const e of MANIFEST) {
      const shape = shapeOf(e)
      if (!shape) continue
      for (const p of e.props) {
        const field = shape[p.name]
        if (!field) continue
        const sd = schemaDefault(field)
        if (sd === undefined) continue // no schema default → nothing to enforce
        if (!sameDefault(sd, p.default))
          drift.push(`${e.name}.${p.name}: manifest=${p.default} schema=${sd}`)
      }
    }
    expect(drift, `defaults drifted from the schema:\n${drift.join('\n')}`).toEqual([])
  })

  it('every enum prop lists exactly its schema enum values', () => {
    const bad: string[] = []
    for (const e of MANIFEST) {
      const shape = shapeOf(e)
      if (!shape) continue
      for (const p of e.props) {
        const field = shape[p.name]
        if (!field) continue
        const def = innerDef(field)
        if (def?.typeName !== 'ZodEnum') continue
        if (JSON.stringify(p.enumValues ?? []) !== JSON.stringify(def.values ?? [])) {
          bad.push(
            `${e.name}.${p.name}: manifest=${JSON.stringify(p.enumValues)} schema=${JSON.stringify(def.values)}`,
          )
        }
      }
    }
    expect(bad, `enum values out of sync:\n${bad.join('\n')}`).toEqual([])
  })

  it('every schema prop is present in the manifest props (coverage)', () => {
    const missing: string[] = []
    for (const e of MANIFEST) {
      const shape = shapeOf(e)
      if (!shape) continue
      const names = new Set(e.props.map((p) => p.name))
      for (const k of Object.keys(shape)) if (!names.has(k)) missing.push(`${e.name}.${k}`)
    }
    expect(missing, `schema props missing from the manifest:\n${missing.join('\n')}`).toEqual([])
  })
})
