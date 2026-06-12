//! Text extraction — what does this entry SAY, at what size, in what color?
//!
//! Driven by the `@onda/components` manifest (per-prop semantic roles), so the
//! inspector knows each component's text props + defaults without hardcoding
//! eighty dialects. A `TextBlock` is one string a viewer reads: content +
//! resolved px font size + resolved color + the measurement options needed to
//! reproduce the component's own metrics.

import { type ManifestEntry, type PropMeta, manifestEntry } from '@onda/components'
import type { ResolvedEntry } from './resolve.js'

/** Brand-resolved theme colors the blocks fall back to. */
export interface InspectTheme {
  text: string
  textMuted: string
  background: string
}

/** One readable string on an entry. */
export interface TextBlock {
  /** The prop carrying the string (`title`, `text`, …). */
  textProp: string
  content: string
  /** Resolved px font size (explicit > manifest default > 48). */
  fontSize: number
  /** The prop that carries the size — the mechanical `fix` target. */
  sizeProp?: string
  /** Resolved color string, when determinable. */
  color?: string
  /** True when the color came from an explicit prop (vs a theme fallback). */
  colorExplicit: boolean
  fontWeight: number
  fontFamily?: string
  letterSpacing?: number
  /** The component's own auto-fit contract, when it has one. */
  fit?: 'none' | 'frame'
  maxWidth?: number
}

/** Parse a PropMeta `default` literal (TS source text) to a JS value. */
export function parseDefault(literal: string | undefined): unknown {
  if (literal === undefined) return undefined
  const s = literal.trim()
  if (s === 'true') return true
  if (s === 'false') return false
  const n = Number(s)
  if (s !== '' && Number.isFinite(n)) return n
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith('`') && s.endsWith('`'))
  )
    return s.slice(1, -1)
  return undefined
}

const wordsOf = (s: string): number => s.split(/\s+/).filter(Boolean).length

/** Total word count across an entry's text blocks. */
export function totalWords(blocks: TextBlock[]): number {
  return blocks.reduce((sum, b) => sum + wordsOf(b.content), 0)
}

// CSS letter-spacing → px ('-0.02em' scales by fontSize; '2px'/number pass).
function letterSpacingPx(value: unknown, fontSize: number): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return undefined
  const n = Number.parseFloat(value.trim())
  if (!Number.isFinite(n)) return undefined
  return value.trim().endsWith('em') ? n * fontSize : n
}

function propValue(entry: ResolvedEntry, meta: PropMeta | undefined, name: string): unknown {
  const explicit = entry.adapted[name]
  if (explicit !== undefined) return explicit
  return parseDefault(meta?.default)
}

/** Components whose primary text WRAPS to multiple lines (their `maxWidth` is a
 *  canvas fraction, not a px cap) — excluded from single-line overflow math. */
export const WRAPPING_COMPONENTS = new Set(['Captions'])

/** The size prop paired with a text prop: `titleSize` for `title`, else the
 *  manifest's single `fontSize`-role prop, else none. */
function sizePropFor(m: ManifestEntry, textProp: string): PropMeta | undefined {
  const sizeProps = m.props.filter((p) => p.role === 'fontSize')
  const prefixed = sizeProps.find(
    (p) => p.name === `${textProp}Size` || p.name === `${textProp}FontSize`,
  )
  if (prefixed) return prefixed
  if (textProp === 'text' || sizeProps.length === 1)
    return sizeProps.find((p) => p.name === 'fontSize') ?? sizeProps[0]
  return undefined
}

/** The color prop paired with a text prop: `titleColor` for `title`, else the
 *  bare `color` prop for the primary `text`. */
function colorPropFor(m: ManifestEntry, textProp: string): PropMeta | undefined {
  const colorProps = m.props.filter((p) => p.role === 'color')
  return (
    colorProps.find((p) => p.name === `${textProp}Color`) ??
    (textProp === 'text' || colorProps.length === 1
      ? colorProps.find((p) => p.name === 'color')
      : undefined)
  )
}

// A themed color prop whose doc names the muted token falls back to textMuted.
const MUTED_HINT = /textmuted|muted|dim\b/i

/** Extract the readable text blocks of an entry, with sizes/colors resolved
 *  (explicit props win; manifest defaults and theme tokens fill the gaps).
 *  Empty for unknown components or entries with no string text props. */
export function textBlocks(entry: ResolvedEntry, theme: InspectTheme): TextBlock[] {
  const m = manifestEntry(entry.component)
  if (!m) return []
  const blocks: TextBlock[] = []
  for (const p of m.props) {
    if (p.role !== 'text') continue
    const value = propValue(entry, p, p.name)
    if (typeof value !== 'string' || value.trim() === '') continue

    const sizeMeta = sizePropFor(m, p.name)
    const sizeValue = sizeMeta ? propValue(entry, sizeMeta, sizeMeta.name) : undefined
    const fontSize = typeof sizeValue === 'number' && sizeValue > 0 ? sizeValue : 48

    const colorMeta = colorPropFor(m, p.name)
    const explicitColor = colorMeta ? entry.adapted[colorMeta.name] : undefined
    let color: string | undefined
    let colorExplicit = false
    if (typeof explicitColor === 'string') {
      color = explicitColor
      colorExplicit = true
    } else if (colorMeta?.themeable) {
      color = MUTED_HINT.test(colorMeta.description) ? theme.textMuted : theme.text
    } else {
      color = theme.text
    }

    const weightMeta = m.props.find((q) => q.name === 'fontWeight')
    const weightValue = weightMeta ? propValue(entry, weightMeta, 'fontWeight') : undefined
    const familyValue = entry.adapted.fontFamily

    const fitValue = entry.adapted.fit
    const maxWidthValue = entry.adapted.maxWidth

    blocks.push({
      textProp: p.name,
      content: value,
      fontSize,
      sizeProp: sizeMeta?.name,
      color,
      colorExplicit,
      fontWeight: typeof weightValue === 'number' ? weightValue : 400,
      fontFamily: typeof familyValue === 'string' ? familyValue : undefined,
      letterSpacing: letterSpacingPx(entry.adapted.letterSpacing, fontSize),
      fit: fitValue === 'frame' || fitValue === 'none' ? fitValue : undefined,
      maxWidth: typeof maxWidthValue === 'number' ? maxWidthValue : undefined,
    })
  }
  return blocks
}
