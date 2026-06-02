//! AudioClip — audio scheduling primitive. Ported from ondajs.
//!
//! In ondajs this wraps Remotion's `<Html5Audio>` to schedule a single audio
//! file with agent-friendly trim, an opt-in fade envelope, optional looping,
//! and a dB-or-amplitude volume contract (music beds, voiceover, SFX).
//!
//! The Onda scene graph is VISUAL-ONLY: `@onda/react` exposes no audio node,
//! and audio mixing/scheduling belongs to the engine audio pipeline, which is
//! not yet surfaced to the React authoring layer. This port is therefore a
//! deliberate NO-RENDER placeholder — it returns an empty `<Group/>` so it can
//! sit in a composition tree without drawing anything. The full prop shape is
//! preserved for API parity so compositions authored against ondajs type-check
//! unchanged; once the audio pipeline is exposed, this component can begin
//! actually scheduling sound with no call-site changes.
//!
//! Until then, `AudioClip` produces NO sound — it only documents intent. Any
//! `volume`/`gainDb`/fade/loop math is intentionally not run here, since there
//! is nothing to apply it to.

import { Group } from '@onda/react'

/** Time spec — seconds (number) or a string like `"0:04"`, `"30s"`, `"500ms"`, `"90f"`. */
export type TimeSpec = string | number

export interface AudioClipProps {
  /** URL or path to the audio file. AAC-in-MP4 or WAV preferred. */
  src?: string
  /**
   * Where to start in the source audio. Time spec — `"0:04"`, `"30s"`,
   * `"500ms"`, `"90f"`, or a raw number of seconds.
   */
  startAt?: TimeSpec
  /**
   * Where to stop in the source. Same time spec as `startAt`. When omitted,
   * plays to the source's end. Required for `loop`.
   */
  endAt?: TimeSpec
  /** Amplitude volume `0..1`. */
  volume?: number
  /**
   * Advanced gain in dB. When set, wins over `volume`. Converted via
   * `10 ** (dB / 20)`: `0` = unity, `-6` ≈ 0.5, `-12` ≈ 0.25, `-20` ≈ 0.1.
   */
  gainDb?: number
  /**
   * Apply an entry/exit volume envelope. Default `true` with a tiny 2-frame
   * click-guard fade. Set larger `fadeDuration` for audible bed fades.
   */
  fade?: boolean
  /** Frames the fade-in / fade-out takes. Default 2 (~67ms @ 30fps). */
  fadeDuration?: number
  /** Loop the trimmed clip. Requires `endAt` (loop interval is `endAt - startAt`). */
  loop?: boolean
  /** Mute the clip. */
  muted?: boolean
  /** Playback speed (browser-clamped 0.0625..16 in ondajs). */
  playbackRate?: number
  /** Acceptable time-shift threshold before resync (seconds). */
  acceptableTimeShiftSeconds?: number
}

/**
 * No-render audio placeholder. Returns an empty `<Group/>`; see the module doc
 * comment for why audio is not yet schedulable from `@onda/react`. Props are
 * accepted (and defaulted to the ondajs schema defaults) purely for API
 * parity — none of them affect the render, which is intentionally empty.
 */
export function AudioClip({
  src: _src = 'https://www.w3schools.com/html/horse.mp3',
  startAt: _startAt = 0,
  endAt: _endAt,
  volume: _volume = 1,
  gainDb: _gainDb,
  fade: _fade = true,
  fadeDuration: _fadeDuration = 2,
  loop: _loop = false,
  muted: _muted = false,
  playbackRate: _playbackRate = 1,
  acceptableTimeShiftSeconds: _acceptableTimeShiftSeconds = 0.1,
}: AudioClipProps = {}) {
  // Visual-only scene graph: nothing to draw, nothing to schedule (yet).
  return <Group />
}
