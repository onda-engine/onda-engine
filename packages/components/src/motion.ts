//! Canonical motion tokens — durations, stagger, springs, overshoot.
//!
//! Ported verbatim from ondajs (`lib/motion.ts`). Every component references
//! these tokens rather than embedding raw frame counts or spring configs: the
//! motion signature comes from the closed system; raw values fragment it.
//!
//! Values are video-paced for a 30fps house composition. UI-animation
//! literature quotes 200–500ms; Onda renders to video, where the eye has time
//! to follow and there are no gestures to acknowledge, so durations run longer.

/**
 * Duration scale in frames at 30fps. Reach for these before hardcoding a frame
 * count. At other framerates, scale via `Math.round(DURATION.x * fps / 30)`.
 *
 * - `instant` (6f / 0.20s) — micro shifts
 * - `fast`    (10f / 0.33s) — exits, small moves
 * - `base`    (22f / 0.73s) — default entrance
 * - `slow`    (28f / 0.93s) — large entrances, hero moves
 * - `slower`  (34f / 1.13s) — full scene transitions
 * - `hold`    (48f / 1.60s) — minimum settled hold
 *
 * Pacing note: entrances run on the slower side and every reveal is meant to
 * *settle and hold* before the next move — confidence reads as stillness, not
 * constant motion. Keep one primary move per beat.
 */
export const DURATION = {
  instant: 6,
  fast: 10,
  base: 22,
  slow: 28,
  slower: 34,
  hold: 48,
} as const

/** Keys of {@link DURATION} — useful for typed props that pick a duration. */
export type DurationToken = keyof typeof DURATION

/** Canonical stagger between sibling elements (lists, words, grouped reveals).
 *  `5` frames @ 30fps ≈ 0.17s — a pronounced, orchestrated wave that choreographs
 *  the eye. One value, used everywhere. */
export const STAGGER = 5

/** Hero-landing overshoot magnitude — a 3% scale bump that settles back to 1.
 *  Reserved for the two-phase landing pattern (see `heroReveal`). */
export const OVERSHOOT = 0.03

/** The house spring — smooth, settled, no overshoot. The Onda fingerprint.
 *  Heavily overdamped (damping ratio ≈ 10): a confident settle, never a bounce. */
export const SPRING_SMOOTH = {
  damping: 200,
  stiffness: 100,
  mass: 1,
} as const

/** Faster spring for decisive elements (counters, value swaps, cursor moves).
 *  Still heavily overdamped — snappiness via higher stiffness, not less damping. */
export const SPRING_SNAPPY = {
  damping: 120,
  stiffness: 180,
  mass: 1,
} as const

/** Stagger offset in frames for the i-th sibling in a grouped reveal. The single
 *  canonical helper — every cascade goes through here so stagger stays
 *  consistent and greppable. */
export const staggerFrames = (index: number, increment: number = STAGGER): number => {
  return Math.max(0, index) * increment
}
