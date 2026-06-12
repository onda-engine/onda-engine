//! TimeInput — one duration grammar for every delay/duration-typed prop.
//!
//! Historically component timing props took FRAMES as bare numbers while the
//! cinema timeline accepted human time specs ("0.5s") — so the same author had
//! to think in two units. Every timing prop now accepts {@link TimeInput}:
//!
//! - `number`  → frames, exactly as before (full back-compat);
//! - `'0.5s'`  → seconds  (×fps);
//! - `'500ms'` → milliseconds;
//! - `'12f'`   → frames, explicit;
//! - `'1:30'`  → minutes:seconds.
//!
//! The grammar mirrors `@onda/cinema`'s `timeSpecToSeconds` EXCEPT for the bare
//! number, which stays frames here because that is what component props have
//! always meant. Parse once at the top of a component with {@link framesOf}
//! (fps in hand from `useVideoConfig`), then do frame math as usual.

import { z } from 'zod'

/** A duration/delay value: frames as a number (the historical form) or a human
 *  time string — `'0.5s'`, `'500ms'`, `'12f'`, `'1:30'`. */
export type TimeInput = number | string

/** Parse a {@link TimeInput} to FRAMES (rounded). Numbers pass through as
 *  frames; strings parse per the cinema time grammar. Invalid/empty strings
 *  and `undefined` resolve to `fallback` (default 0). Never throws. */
export function framesOf(value: TimeInput | undefined, fps: number, fallback = 0): number {
  if (value == null) return fallback
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  const s = value.trim()
  if (s === '') return fallback
  if (s.includes(':')) {
    const [m, sec] = s.split(':')
    return Math.round(((Number(m) || 0) * 60 + (Number(sec) || 0)) * fps)
  }
  if (s.endsWith('ms')) return Math.round(((Number(s.slice(0, -2)) || 0) / 1000) * fps)
  if (s.endsWith('f')) return Math.round(Number(s.slice(0, -1)) || 0)
  if (s.endsWith('s')) return Math.round((Number(s.slice(0, -1)) || 0) * fps)
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

/** The Zod schema for a {@link TimeInput} prop — shared by the component
 *  schemas so the Studio agent validates one duration grammar. */
export const timeSchema = z.union([z.number(), z.string()])

/** One-line description suffix for converted manifest/schema props. */
export const TIME_DESCRIPTION =
  "Accepts frames (number) or a time string ('0.5s', '500ms', '12f', '1:30')."
