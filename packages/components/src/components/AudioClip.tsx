//! AudioClip — audio scheduling for a composition. Ported from ondajs.
//!
//! Emits a non-visual `<Audio>` node (`@onda/react`): the player plays it during
//! preview (synced to play/pause + scrub, with the player's volume), and it rides
//! in the scene graph so export can mux it. v1 wires `src` + `startAt` (source
//! trim) + `volume`/`gainDb`; the fade envelope, `loop`, `endAt`, and
//! `playbackRate` are accepted for API parity but not yet applied to playback.

import { Audio, useVideoConfig } from '@onda/react'
import type { TimeInput } from '../time.js'

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
   * plays to the source's end. Required for `loop`. (Not yet applied in preview.)
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
   * Apply an entry/exit volume envelope. Default `true`. (Not yet applied in
   * preview; accepted for API parity.)
   */
  fade?: boolean
  /** Frames the fade-in / fade-out takes. Default 2 (~67ms @ 30fps). */
  fadeDuration?: TimeInput
  /** Loop the trimmed clip. Requires `endAt`. (Not yet applied in preview.) */
  loop?: boolean
  /** Mute the clip. */
  muted?: boolean
  /** Playback speed. (Not yet applied in preview.) */
  playbackRate?: number
  /** Acceptable time-shift threshold before resync (seconds). */
  acceptableTimeShiftSeconds?: number
}

/** Resolve a {@link TimeSpec} to seconds (`90f` uses `fps`). */
function toSeconds(t: TimeSpec | undefined, fps: number): number {
  if (t === undefined) return 0
  if (typeof t === 'number') return Math.max(0, t)
  const s = t.trim()
  const colon = s.match(/^(\d+):(\d+(?:\.\d+)?)$/) // "M:SS"
  if (colon) return Number.parseInt(colon[1] ?? '0', 10) * 60 + Number.parseFloat(colon[2] ?? '0')
  if (s.endsWith('ms')) return Number.parseFloat(s) / 1000
  if (s.endsWith('f')) return Number.parseFloat(s) / Math.max(1, fps)
  if (s.endsWith('s')) return Number.parseFloat(s)
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

/**
 * Schedule an audio clip. Plays from the composition start (place inside a
 * `<Sequence>` to offset — Sequence-relative start is a follow-up), trimming the
 * source by `startAt`, at `volume` (or `gainDb`). Emits a `<Audio>` node, which
 * draws nothing; the player plays it for preview.
 */
export function AudioClip({
  src = 'https://www.w3schools.com/html/horse.mp3',
  startAt = 0,
  volume = 1,
  gainDb,
  muted = false,
}: AudioClipProps = {}) {
  const { fps } = useVideoConfig()
  const startAtSecs = toSeconds(startAt, fps)
  const gain = gainDb !== undefined ? 10 ** (gainDb / 20) : volume
  return <Audio src={src} start={0} startAt={startAtSecs} volume={muted ? 0 : gain} />
}
