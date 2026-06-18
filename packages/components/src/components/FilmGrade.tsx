//! FilmGrade — a one-prop cinematic LOOK over the engine's per-node `grade`
//! effect (color_grade). The "land AI media" wedge: wrap a whole composition
//! (especially mixed AI-generated clips with clashing white balance and
//! saturation) in a single named film look so it reads as ONE graded film.
//!
//! Each `look` is a tasteful, restrained preset of grade params (exposure,
//! contrast, saturation, temperature, tint). `intensity` lerps every param from
//! the neutral identity (exposure 0, contrast 1, saturation 1, temperature 0,
//! tint 0) toward the look, so `intensity={0}` is a no-op and `intensity={0.5}`
//! is the look at half strength. Explicit overrides apply on top of the resolved
//! look, for fine-tuning without abandoning the preset.
//!
//! Implementation: resolves to a single `<Group grade={…}>` wrapping the subtree
//! — a TRANSPARENT passthrough (a Group does not re-layout its children, so their
//! absolute positions are preserved; an AbsoluteFill would flex-reflow them), so
//! the grade applies to the node's entire subtree. Honored by Vello AND the CPU
//! reference (the
//! grade is a per-pixel remap, no blur), so FilmGrade is `both`-backend and
//! engine-native — not a CSS-filter approximation.

import { Group } from '@onda-engine/react'
import type { ReactNode } from 'react'
import { useTheme } from '../theme.js'

/** The named cinematic looks. */
export type FilmLook = 'warm' | 'cool' | 'noir' | 'teal-orange' | 'vibrant' | 'film' | 'faded'

/** The five grade params (mirrors the engine's `color_grade` effect). */
interface GradeParams {
  exposure: number
  contrast: number
  saturation: number
  temperature: number
  tint: number
}

/** The neutral identity — `intensity={0}` lerps every look back to this (a
 *  render no-op). */
const NEUTRAL: GradeParams = {
  exposure: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
}

/** Look → grade params. Restrained on purpose: a grade is set-dressing, not a
 *  party trick — these nudge white balance / contrast / saturation, they don't
 *  blow the image out. */
const LOOKS: Record<FilmLook, GradeParams> = {
  // Gentle golden-hour warmth: a touch of exposure + warm temp, contrast held.
  warm: { exposure: 0.05, contrast: 1.05, saturation: 1.05, temperature: 0.22, tint: 0.04 },
  // Crisp, clean daylight pushed cold: cool temp, a faint magenta tint, slight
  // contrast for a clinical / tech look.
  cool: { exposure: 0, contrast: 1.08, saturation: 0.96, temperature: -0.25, tint: -0.05 },
  // Black-and-white drama: saturation to 0 (grayscale), contrast up, a hair of
  // exposure lift to keep the mids alive.
  noir: { exposure: 0.03, contrast: 1.25, saturation: 0, temperature: 0, tint: 0 },
  // The Hollywood blockbuster split-tone: warm skin against cool shadows —
  // warm temp + a slight desaturate + a contrast bump (the engine's grade is
  // global, so we evoke the look via warm balance + punch rather than a true
  // shadow/highlight split).
  'teal-orange': {
    exposure: 0.02,
    contrast: 1.14,
    saturation: 0.92,
    temperature: 0.18,
    tint: -0.04,
  },
  // Punchy, saturated commercial pop: contrast + saturation up, exposure lifted
  // a touch, balance left neutral.
  vibrant: { exposure: 0.06, contrast: 1.12, saturation: 1.3, temperature: 0.03, tint: 0 },
  // The default — a subtle, all-purpose cinematic base: a whisper of warmth and
  // contrast, saturation eased back so it never looks digital. Unifies clips
  // without announcing itself.
  film: { exposure: 0.02, contrast: 1.06, saturation: 0.95, temperature: 0.08, tint: 0.01 },
  // Faded / washed indie look: lifted blacks via LOW contrast, a desaturated
  // pull, a faint cool cast. The "matte film" feel.
  faded: { exposure: 0.04, contrast: 0.85, saturation: 0.82, temperature: -0.06, tint: 0.02 },
}

export interface FilmGradeProps {
  /** The named cinematic look applied to the whole subtree. Default `'film'`. */
  look?: FilmLook
  /**
   * Strength of the look, `0..1`. Lerps every grade param from the neutral
   * identity toward the look: `0` = no grade (pass-through), `1` = the full
   * look. Default `1`.
   */
  intensity?: number
  /** Explicit linear-exposure override (`2^exposure`; 0 = identity), applied on
   *  top of the resolved look. */
  exposure?: number
  /** Explicit contrast override (1 = identity), applied on top of the look. */
  contrast?: number
  /** Explicit saturation override (1 = identity, 0 = grayscale), on top of the look. */
  saturation?: number
  /** Explicit warm/cool override (R up / B down for positive; 0 = neutral), on top. */
  temperature?: number
  /** Explicit green/magenta override (positive = green; 0 = neutral), on top. */
  tint?: number
  /** The graded subtree — typically the whole composition. */
  children?: ReactNode
}

/** Clamp `n` into `[lo, hi]`. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function FilmGrade({
  look = 'film',
  intensity = 1,
  exposure,
  contrast,
  saturation,
  temperature,
  tint,
  children,
}: FilmGradeProps) {
  // Touch the theme so the hook order stays stable with the other components.
  useTheme()

  const preset = LOOKS[look] ?? LOOKS.film
  const t = clamp(intensity, 0, 1)

  // Lerp each param from the neutral identity toward the look by `intensity`.
  const resolved: GradeParams = {
    exposure: lerp(NEUTRAL.exposure, preset.exposure, t),
    contrast: lerp(NEUTRAL.contrast, preset.contrast, t),
    saturation: lerp(NEUTRAL.saturation, preset.saturation, t),
    temperature: lerp(NEUTRAL.temperature, preset.temperature, t),
    tint: lerp(NEUTRAL.tint, preset.tint, t),
  }

  // Explicit overrides win over the resolved look (applied on top).
  if (typeof exposure === 'number') resolved.exposure = exposure
  if (typeof contrast === 'number') resolved.contrast = contrast
  if (typeof saturation === 'number') resolved.saturation = saturation
  if (typeof temperature === 'number') resolved.temperature = temperature
  if (typeof tint === 'number') resolved.tint = tint

  // A transparent Group wrapping the subtree (children keep their own positions;
  // a flex AbsoluteFill would reflow them). `grade` resolving to the neutral
  // identity is a render no-op, so `intensity={0}` with no overrides passes
  // through untouched.
  return <Group grade={resolved}>{children}</Group>
}
