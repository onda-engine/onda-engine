//! Web Audio transport for the Player's preview.
//!
//! The preview's visual frame-clock pegs the main thread (the per-frame wasm/GPU
//! render), and an HTML `<audio>` element leans on the main thread for buffering
//! and servicing — so under that load it underruns and glitches every second or
//! two. This plays each clip through the **Web Audio API** instead: the source is
//! decoded ONCE into an in-memory `AudioBuffer` and scheduled on the audio render
//! thread, which is immune to main-thread jank. No streaming, no per-frame seeks,
//! no loop-seam click.
//!
//! Model: the timeline is the master clock. On play we anchor the audio to the
//! playhead (a `compTime` ↔ `AudioContext.currentTime` mapping) and schedule clip
//! instances cycle-by-cycle with a look-ahead, so a looping timeline is gapless
//! (the next cycle is queued before the current one ends — no JS seek at the wrap).
//! We re-anchor only on an explicit play/seek/rate change, never to chase drift.
//!
//! Export is unaffected — it muxes the same nodes through the native pipeline.

import type { AudioClip } from './audio.js'

/** Seconds of audio kept scheduled ahead of the playhead. Comfortably spans a
 *  background tab's throttled top-up interval so playback never runs dry. */
const LOOKAHEAD = 2
/** How often (ms) we top up the schedule with upcoming loop cycles. */
const TOPUP_INTERVAL = 250
/** Master-gain ramp (s) — a short ramp instead of a step avoids a click on
 *  mute/unmute and volume changes. */
const GAIN_RAMP = 0.012

interface ClipState {
  clip: AudioClip
  buffer: AudioBuffer | null
  gain: GainNode | null
  decoding: boolean
}

/** One per `<Player>`. Browser-only — instantiate inside an effect. The
 *  `AudioContext` is created lazily on first {@link play} so we never spin one up
 *  before a user gesture (autoplay policy) or during SSR. */
export class PreviewAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private clips: ClipState[] = []
  /** Decoded buffers keyed by src, reused across `setClips` so the editor's
   *  frequent composition edits don't re-fetch/re-decode unchanged audio. */
  private bufferCache = new Map<string, AudioBuffer>()
  /** Bumped on every `setClips` so a stale in-flight decode can't apply. */
  private clipsToken = 0

  private period = 1 // one timeline cycle, seconds (always > 0)
  private loop = false
  private rate = 1
  private volume = 1
  private muted = false

  private playing = false
  private anchorCtx = 0 // AudioContext time at `anchorComp`
  private anchorComp = 0 // composition time (s) at the anchor
  private nextCycle: number[] = [] // per clip: next loop cycle index to schedule
  private active: AudioBufferSourceNode[] = []
  private timer: ReturnType<typeof setInterval> | null = null

  // ── public API ──────────────────────────────────────────────────────────

  /** Master volume × mute. Applied as a short ramp (click-free). */
  setGain(volume: number, muted: boolean): void {
    this.volume = volume
    this.muted = muted
    this.applyMaster()
  }

  setLoop(loop: boolean): void {
    this.loop = loop // the top-up loop reads this each tick; no reschedule needed
  }

  /** Swap the clip set (composition changed) and the timeline period. Tears down
   *  the current schedule, (re)decodes as needed, and reschedules if playing. */
  setClips(clips: AudioClip[], periodSeconds: number): void {
    this.period = Math.max(0.001, periodSeconds)
    this.stopActive()
    const token = ++this.clipsToken
    this.clips = clips.map((clip) => ({ clip, buffer: null, gain: null, decoding: false }))
    if (this.ctx) {
      this.wireClipGains()
      for (const cs of this.clips) this.ensureDecoded(cs, token)
      if (this.playing) this.reanchor(this.currentComp())
    }
    // No ctx yet → decode + wiring deferred to the first play().
  }

  setRate(rate: number): void {
    if (this.rate === rate) return
    const comp = this.playing ? this.currentComp() : this.anchorComp
    this.rate = rate
    // We only play at 1× (off-speed would pitch-shift); re-anchoring restarts the
    // schedule, which `scheduleAhead` then skips while rate ≠ 1.
    if (this.playing) this.reanchor(comp)
    else this.applyMaster()
  }

  /** Start (or restart) playback anchored at `compTime` (seconds). */
  play(compTime: number): void {
    const ctx = this.ensureCtx()
    void ctx.resume().catch(() => {})
    this.playing = true
    const token = this.clipsToken
    for (const cs of this.clips) this.ensureDecoded(cs, token)
    this.reanchor(compTime)
    this.startTimer()
  }

  pause(): void {
    this.playing = false
    this.stopActive()
    this.stopTimer()
  }

  /** Re-anchor to a new playhead. While playing this restarts the schedule from
   *  `compTime`; while paused it just records the position for the next play. */
  seek(compTime: number): void {
    if (this.playing) this.reanchor(compTime)
    else this.anchorComp = compTime
  }

  dispose(): void {
    this.stopActive()
    this.stopTimer()
    this.clips = []
    this.bufferCache.clear()
    if (this.ctx) {
      void this.ctx.close().catch(() => {})
      this.ctx = null
      this.master = null
    }
  }

  // ── internals ───────────────────────────────────────────────────────────

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.connect(this.ctx.destination)
      this.applyMaster()
      this.wireClipGains()
    }
    return this.ctx
  }

  /** Give every clip a per-clip gain (its own volume) feeding the master. */
  private wireClipGains(): void {
    if (!this.ctx || !this.master) return
    for (const cs of this.clips) {
      if (!cs.gain) {
        const g = this.ctx.createGain()
        g.gain.value = Math.max(0, Math.min(1, cs.clip.volume))
        g.connect(this.master)
        cs.gain = g
      }
    }
  }

  private ensureDecoded(cs: ClipState, token: number): void {
    if (cs.buffer || cs.decoding || !this.ctx) return
    const cached = this.bufferCache.get(cs.clip.src)
    if (cached) {
      cs.buffer = cached
      return
    }
    cs.decoding = true
    const ctx = this.ctx
    void (async () => {
      try {
        const res = await fetch(cs.clip.src)
        const bytes = await res.arrayBuffer()
        const decoded = await ctx.decodeAudioData(bytes)
        if (token !== this.clipsToken) return // superseded by a newer setClips
        this.bufferCache.set(cs.clip.src, decoded)
        cs.buffer = decoded
        cs.decoding = false
        if (this.playing) this.scheduleAhead() // newly-ready clip joins the schedule
      } catch (err) {
        cs.decoding = false
        // Leave buffer null → the clip is silently skipped (not fatal to preview).
        console.warn('[onda] preview audio decode failed:', cs.clip.src, err)
      }
    })()
  }

  /** Composition time (s) currently under the playhead, derived from the anchor. */
  private currentComp(): number {
    if (!this.ctx) return this.anchorComp
    return this.anchorComp + (this.ctx.currentTime - this.anchorCtx) * this.rate
  }

  private compToCtx(compTime: number): number {
    return this.anchorCtx + (compTime - this.anchorComp) / this.rate
  }

  private reanchor(compTime: number): void {
    this.stopActive()
    const ctx = this.ensureCtx()
    this.anchorCtx = ctx.currentTime
    this.anchorComp = compTime
    const startCycle = this.loop ? Math.floor(compTime / this.period) : 0
    this.nextCycle = this.clips.map(() => startCycle)
    this.applyMaster()
    this.scheduleAhead()
  }

  /** Queue every clip instance whose start falls within the look-ahead window.
   *  Idempotent + incremental: `nextCycle[i]` tracks how far each clip is queued,
   *  so repeated calls only add the newly-reachable cycles. */
  private scheduleAhead(): void {
    // Off-speed preview plays silent (raw playbackRate would chipmunk) — schedule
    // nothing until the rate returns to 1×.
    if (!this.playing || !this.ctx || this.rate !== 1) return
    const ctx = this.ctx
    const horizon = ctx.currentTime + LOOKAHEAD
    for (let i = 0; i < this.clips.length; i++) {
      const cs = this.clips[i]
      if (!cs || !cs.buffer || !cs.gain) continue
      const bufDur = cs.buffer.duration
      for (let guard = 0; guard < 512; guard++) {
        const k = this.nextCycle[i] ?? 0
        const compClipStart = k * this.period + cs.clip.start
        let ctxStart = this.compToCtx(compClipStart)
        if (ctxStart >= horizon) break

        let offset = cs.clip.startAt
        // The clip plays until the source ends OR the timeline cycle wraps.
        let dur = Math.min(bufDur - offset, this.period - cs.clip.start)
        // If this instance's start is already behind the playhead (the partial
        // cycle at the anchor, or a clip that began before we anchored), begin it
        // now from the corresponding offset instead of in the past.
        if (ctxStart < ctx.currentTime) {
          const late = (ctx.currentTime - ctxStart) * this.rate
          offset += late
          dur -= late
          ctxStart = ctx.currentTime
        }
        if (dur > 0.005 && offset < bufDur) {
          const src = ctx.createBufferSource()
          src.buffer = cs.buffer
          src.connect(cs.gain)
          src.onended = () => {
            const idx = this.active.indexOf(src)
            if (idx >= 0) this.active.splice(idx, 1)
            try {
              src.disconnect()
            } catch {
              // already torn down
            }
          }
          // playbackRate stays 1 (we only schedule at 1×); `dur` is buffer-seconds.
          try {
            src.start(ctxStart, offset, dur)
            this.active.push(src)
          } catch {
            // start() can throw if the ctx is mid-teardown — ignore.
          }
        }
        this.nextCycle[i] = k + 1
        if (!this.loop) break // non-looping: only the current cycle exists
      }
    }
  }

  private applyMaster(): void {
    if (!this.master || !this.ctx) return
    const target = this.muted || this.rate !== 1 ? 0 : Math.max(0, Math.min(1, this.volume))
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, GAIN_RAMP)
  }

  private stopActive(): void {
    for (const src of this.active) {
      src.onended = null
      try {
        src.stop()
      } catch {
        // not started / already stopped
      }
      try {
        src.disconnect()
      } catch {
        // already disconnected
      }
    }
    this.active = []
  }

  private startTimer(): void {
    if (this.timer != null) return
    this.timer = setInterval(() => this.scheduleAhead(), TOPUP_INTERVAL)
  }

  private stopTimer(): void {
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
