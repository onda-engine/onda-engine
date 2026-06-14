//! Shared text-style contract — the cross-cutting typography knobs EVERY text
//! component should expose, so the agent (and authors) can ALWAYS set them. The
//! audit found these scattered: `italic` on 7/48 components, `letterSpacing` on
//! 1, `uppercase` on 1. This is the one place they live.
//!
//! The set mirrors what motion-graphics tools standardize on (After Effects'
//! character panel, kinetic-typography practice): family, weight, style, color,
//! and TRACKING — `letterSpacing` is the one that keeps animated type from
//! blurring together in motion, the single most-reached-for type knob in mograph.
//! `uppercase` (geometric-sans all-caps is a mograph staple) is applied at the
//! component level since the engine scene `Text` has no text-transform. Leading
//! (`line-height`) is engine-fixed at 1.2 today — a future engine knob.

import { z } from 'zod'
import type { Theme } from './theme.js'

export interface TextStyleProps {
  /** Text color (hex `#rrggbb` / `#rrggbbaa`). Default: theme `text`. */
  color?: string
  /** Loaded font family by name (any Google family; set it via `onda render
   *  --font` or a brand profile). Default: theme `fontFamily`. */
  fontFamily?: string
  /** Font weight (100–900). */
  fontWeight?: number
  /** Italic / oblique. */
  italic?: boolean
  /** TRACKING — extra px between glyphs (CSS `letter-spacing`). Positive opens
   *  type up (premium display type + fast-moving text want air); negative
   *  tightens. Default `0` (the font's natural spacing). */
  letterSpacing?: number
  /** Uppercase the text — a motion-graphics staple (bold geometric-sans all-caps).
   *  Applied to the string itself, so it survives per-glyph layout. */
  uppercase?: boolean
}

export interface ResolvedTextStyle {
  color: string
  fontFamily: string | undefined
  fontWeight: number
  italic: boolean
  letterSpacing: number | undefined
}

/** Resolve the shared text props against the theme + a component's existing
 *  defaults. Pass the component's current defaults (its weight, mono family,
 *  accent color) so callers that DON'T set the new knobs render identically. */
export function resolveTextStyle(
  props: TextStyleProps,
  theme: Theme,
  defaults: { fontWeight?: number; fontFamily?: string; color?: string } = {},
): ResolvedTextStyle {
  return {
    color: props.color ?? defaults.color ?? theme.text,
    fontFamily: props.fontFamily ?? defaults.fontFamily ?? theme.fontFamily,
    fontWeight: props.fontWeight ?? defaults.fontWeight ?? 500,
    italic: props.italic ?? false,
    letterSpacing: props.letterSpacing,
  }
}

/** Apply the `uppercase` transform (the engine scene `Text` has no
 *  text-transform, so it happens on the string here). */
export function applyTextCase(text: string, props: Pick<TextStyleProps, 'uppercase'>): string {
  return props.uppercase ? text.toUpperCase() : text
}

/** Zod shape for the shared text-style props — spread into a component's schema
 *  (`z.object({ ...textStyleSchemaShape, ... })`) so the Studio agent sees the
 *  SAME typography knobs on every text component. */
export const textStyleSchemaShape = {
  color: z
    .string()
    .optional()
    .describe('Text color (hex #rrggbb / #rrggbbaa). Default: theme text color.'),
  fontFamily: z
    .string()
    .optional()
    .describe('Loaded font family by NAME (any Google family). Default: the theme font.'),
  fontWeight: z.number().optional().describe('Font weight 100–900.'),
  italic: z.boolean().optional().describe('Italic / oblique text.'),
  letterSpacing: z
    .number()
    .optional()
    .describe(
      'Tracking — extra px between glyphs. Positive opens the type up (good for display type and fast-moving text); negative tightens. Default 0.',
    ),
  uppercase: z.boolean().optional().describe('Uppercase the text (a motion-graphics staple).'),
} as const
