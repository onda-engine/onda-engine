//! Clip-aware timing — "does this entrance land before the cut?" as a NUMBER.
//!
//! Three pieces:
//!
//! - {@link settleTime} — the registry: per-component settle calculators
//!   (`(props, fps) → frames`) for every animated component whose entrance has
//!   a computable end. The same formulas the components run, so a director (or
//!   the Studio agent) can ask up front whether a 1.4s beat fits a slot-roll.
//! - {@link staggeredSettle} — the shared formula most entrances reduce to
//!   (`delay + (n−1)×stagger + duration`), used by the registry AND the
//!   components so the two can't drift.
//! - {@link useTimeScale} — the clamp: resolves `fitToClip`/`maxSettle` props
//!   into a ≤1 time-scale factor a component multiplies its delays/durations
//!   by, so the WHOLE envelope compresses to land inside `clip − hold`.
//!   `fitToClip` reads the clip length from `useVideoConfig().durationInFrames`
//!   (scoped to the enclosing `<Sequence>`; the cinema bridge wraps every entry
//!   in one, so clip length flows automatically).
//!
//! All registry inputs accept {@link TimeInput} (frames or '0.5s' strings),
//! parsed with the same grammar the components use.

import { useVideoConfig } from '@onda/react'
import { DURATION, STAGGER } from './motion.js'
import { type TimeInput, framesOf } from './time.js'

/** `delay + (n−1)×stagger + duration` — the settle of a staggered entrance.
 *  All values in FRAMES. */
export function staggeredSettle(
  count: number,
  staggerFrames: number,
  durationFrames: number,
  delayFrames = 0,
): number {
  return delayFrames + Math.max(0, count - 1) * staggerFrames + durationFrames
}

/** Loose prop bag — the registry reads only the timing-relevant keys. */
type Props = Record<string, unknown>

/** A per-component settle calculator: total frames from the component's local
 *  frame 0 until its entrance has fully settled (defaults applied). */
export type SettleFn = (props: Props, fps: number) => number

const t = (props: Props, key: string, fps: number, fallback: number): number =>
  framesOf(props[key] as TimeInput | undefined, fps, fallback)
const str = (props: Props, key: string, fallback: string): string =>
  typeof props[key] === 'string' ? (props[key] as string) : fallback
const arr = (props: Props, key: string, fallback: number): number =>
  Array.isArray(props[key]) ? (props[key] as unknown[]).length : fallback

const glyphCount = (text: string): number =>
  Array.from(text).filter((ch) => ch.trim().length > 0).length

/** Settle calculators, keyed by the PascalCase component name. Formulas mirror
 *  the component implementations (see each component's source for the beats). */
export const COMPONENT_SETTLE: Record<string, SettleFn> = {
  // ── entrance / exit wrappers ────────────────────────────────────────────────
  FadeIn: (p, fps) => t(p, 'delay', fps, 0) + t(p, 'durationInFrames', fps, DURATION.base),
  FadeOut: (p, fps) => t(p, 'delay', fps, 0) + t(p, 'durationInFrames', fps, DURATION.fast),
  SlideIn: (p, fps) => t(p, 'delay', fps, 0) + t(p, 'durationInFrames', fps, DURATION.base),
  SlideOut: (p, fps) => t(p, 'delay', fps, 0) + t(p, 'durationInFrames', fps, DURATION.fast),
  ScaleIn: (p, fps) => t(p, 'delay', fps, 0) + t(p, 'durationInFrames', fps, DURATION.base),
  RotateIn: (p, fps) => t(p, 'delay', fps, 0) + t(p, 'durationInFrames', fps, DURATION.base),
  BlurReveal: (p, fps) => t(p, 'delay', fps, 0) + t(p, 'durationInFrames', fps, DURATION.base),
  MaskReveal: (p, fps) => t(p, 'delay', fps, 0) + t(p, 'duration', fps, DURATION.base),

  // ── text family ─────────────────────────────────────────────────────────────
  Typewriter: (p, fps) => t(p, 'delay', fps, 0) + t(p, 'durationInFrames', fps, DURATION.slow),
  CountUp: (p, fps) => t(p, 'delay', fps, 0) + t(p, 'durationInFrames', fps, DURATION.slow),
  TextAnimator: (p, fps) => {
    const text = str(p, 'text', 'Animate')
    const units = str(p, 'units', 'glyph')
    const n =
      units === 'line'
        ? text.split('\n').filter((l) => l.trim().length > 0).length
        : units === 'word'
          ? text.split(/\s+/).filter(Boolean).length
          : glyphCount(text)
    return staggeredSettle(
      n,
      t(p, 'stagger', fps, STAGGER),
      t(p, 'durationInFrames', fps, DURATION.base),
      t(p, 'delay', fps, 0),
    )
  },
  KineticText: (p, fps) =>
    staggeredSettle(
      glyphCount(str(p, 'text', 'kinetic')),
      t(p, 'stagger', fps, STAGGER),
      t(p, 'durationInFrames', fps, DURATION.base),
      t(p, 'delay', fps, 0),
    ),
  MatrixDecode: (p, fps) =>
    staggeredSettle(
      Array.from(str(p, 'text', 'ONDA')).length,
      Math.max(0, t(p, 'charDelay', fps, 3)),
      Math.max(1, t(p, 'scrambleDuration', fps, 18)),
      t(p, 'delay', fps, 0),
    ),
  SlotMachineRoll: (p, fps) =>
    // Roll: delay + (n−1)×charDelay + duration; the accent glow then blooms
    // (DURATION.base − 8) frames past the last landing.
    staggeredSettle(
      Array.from(str(p, 'text', '2026')).length,
      t(p, 'charDelay', fps, STAGGER),
      t(p, 'durationInFrames', fps, DURATION.slower),
      t(p, 'delay', fps, 0),
    ) +
    (DURATION.base - 8),
  WordStagger: (p, fps) =>
    staggeredSettle(
      str(p, 'text', 'Make it move').split(/\s+/).filter(Boolean).length,
      t(p, 'stagger', fps, STAGGER),
      DURATION.base,
      t(p, 'delay', fps, 0),
    ),

  // ── composites (sequenced cards) ───────────────────────────────────────────
  TitleCard: (p, fps) =>
    t(p, 'delay', fps, 0) + (p.subtitle ? 2 * STAGGER + DURATION.base : DURATION.slow), // subtitle trails by 2 stagger steps
  StatCard: (p, fps) => t(p, 'delay', fps, 0) + 4 * STAGGER + DURATION.base, // label lands last
  ChapterCard: (p, fps) => t(p, 'delay', fps, 0) + 34 + DURATION.fast, // underline (delay+34) draws over DURATION.fast
  EndCard: (p, fps) =>
    t(p, 'delay', fps, 0) +
    DURATION.base +
    6 + // HANDLES_OFFSET
    Math.max(0, arr(p, 'handles', 2) - 1) * STAGGER +
    DURATION.base,
  LowerThird: (p, fps) => t(p, 'delay', fps, 0) + 8 + DURATION.base, // underline beat (delay+8) settles last
  InputField: (p, fps) => t(p, 'delay', fps, 0) + t(p, 'typeDuration', fps, 36),
  Terminal: (p, fps) =>
    t(p, 'delay', fps, 0) +
    t(p, 'typeSpeed', fps, 30) +
    t(p, 'outputDelay', fps, 8) +
    Math.max(0, arr(p, 'output', 2) - 1) * STAGGER +
    DURATION.base,
  Button: (p, fps) => {
    const enter = t(p, 'delay', fps, 0) + t(p, 'durationInFrames', fps, DURATION.base)
    const press = p.press === false ? 0 : t(p, 'pressFrame', fps, 30) + 7 // PRESS_OUT
    return Math.max(enter, press)
  },
}

/** Total settle time in FRAMES for `component` with `props` — `delay` included,
 *  defaults applied — or `null` when the component isn't in the registry (not
 *  animated, or its end isn't statically computable). "Does it land before the
 *  cut?" is `settleTime(...) <= clipFrames`. */
export function settleTime(component: string, props: Props = {}, fps = 30): number | null {
  const fn = COMPONENT_SETTLE[component]
  if (!fn) return null
  return Math.ceil(fn(props, fps))
}

/** Clip-fit props shared by the animated components. */
export interface FitToClipOpts {
  /** Compress the WHOLE timing envelope (delay, stagger, durations) so the
   *  entrance settles at least `hold` before the end of the enclosing clip
   *  (`useVideoConfig().durationInFrames`, Sequence-scoped). Opt-in. */
  fitToClip?: boolean
  /** Hard cap on the settle time (frames or '0.5s' string). Wins over
   *  `fitToClip` when both are given. */
  maxSettle?: TimeInput
  /** Breathing room before the cut for `fitToClip` (default `DURATION.instant`
   *  = 6 frames). */
  hold?: TimeInput
}

/** Resolve {@link FitToClipOpts} against a natural settle time (frames) into a
 *  time-scale factor ≤ 1. Multiply every delay/stagger/duration by it. Returns
 *  1 when no fit is requested or the entrance already lands. The compressed
 *  settle never drops below 1 frame. */
export function useTimeScale(naturalSettleFrames: number, opts: FitToClipOpts): number {
  const { fps, durationInFrames } = useVideoConfig()
  let available: number | undefined
  if (opts.maxSettle !== undefined) {
    available = framesOf(opts.maxSettle, fps)
  } else if (opts.fitToClip) {
    available = durationInFrames - framesOf(opts.hold, fps, DURATION.instant)
  }
  if (available === undefined || naturalSettleFrames <= 0) return 1
  return Math.min(1, Math.max(1, available) / naturalSettleFrames)
}
