//! `<Player>` — an interactive, accessible preview of an ONDA composition.
//!
//! Renders each visible frame from `@onda/react`'s `renderFrame` (so what you
//! scrub is the real per-frame scene graph) and paints it to a canvas. By
//! default it paints with the **real ONDA engine** when one is supplied (the
//! `@onda/wasm` `OndaEngine`, pixel-identical to `onda export`), and otherwise
//! falls back to the dependency-free Canvas2D preview.
//!
//! Controls are fully keyboard-accessible (Space = play/pause, ←/→ = step,
//! Shift+←/→ = jump, Home/End = ends), ARIA-labelled, and styled with the ONDA
//! brand tokens (see `assets/brand/BRAND.md`). All non-essential motion respects
//! `prefers-reduced-motion`.

import { registeredFonts, renderFrame } from '@onda/react'
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { PreviewAudio } from './audio-engine.js'
import { type AudioClip, collectAudioClips } from './audio.js'
import { type FrameDrawer, drawScene } from './canvas-renderer.js'
import { type RenderEngine, engineDrawer } from './engine-drawer.js'
import { applyResolvedImages, collectImageUrls, resolveImageUrl } from './images.js'
import { collectVideoOverlays, resolveVideoFrames } from './video.js'

/** An async, GPU renderer — structurally `@onda/wasm-vello`'s `VelloEngine`.
 *  This is the pixel-exact, full-feature path (paths/gradients/clips/AA), so the
 *  Player prefers it. Accepted structurally so `@onda/player` needn't depend on
 *  `@onda/wasm-vello`. */
export interface GpuEngine {
  render(sceneJson: string): Promise<{ width: number; height: number; pixels: Uint8Array }>
  /** Optional: load a custom font (`.ttf`/`.otf` bytes) so the live preview draws
   *  with the same fonts the export will. `@onda/wasm-vello`'s `VelloEngine` exposes
   *  `load_font`; `@onda/wasm`'s `OndaEngine` exposes `loadFont` — the Player drains
   *  the `@onda/react` font registry into whichever exists. */
  loadFont?(data: Uint8Array): unknown
  load_font?(data: Uint8Array): unknown
}

// GPU engines currently mid-render. Keyed on the engine instance so multiple
// <Player>s sharing one engine serialize their `&mut render()` calls (a wasm
// engine panics on re-entrant use). Module-level on purpose — the guard must
// outlive any single component instance.
const enginesRendering = new WeakSet<object>()

// How many registered fonts have been loaded into each engine (keyed on the
// engine instance). The `@onda/react` font registry is append-only, so we load
// only the newly-registered tail into an engine, once — never re-loading a font
// or per frame. Module-level so it survives remounts that reuse an engine.
const engineFontCount = new WeakMap<object, number>()

/** Drain any not-yet-loaded fonts from the `@onda/react` registry into `engine`
 *  (whichever of `loadFont`/`load_font` it exposes), so a composition's custom
 *  fonts render in the live preview, matching export. Cheap to call before every
 *  paint: a no-op once the engine is caught up. Safe inside the per-engine render
 *  guard (synchronous, before `render()`), so it never races a `&mut render`. */
function ensureFontsLoaded(engine: object): void {
  const e = engine as {
    loadFont?: (d: Uint8Array) => unknown
    load_font?: (d: Uint8Array) => unknown
  }
  const load = e.loadFont ?? e.load_font
  if (typeof load !== 'function') return
  const fonts = registeredFonts()
  const loaded = engineFontCount.get(engine) ?? 0
  for (let i = loaded; i < fonts.length; i++) {
    try {
      load.call(engine, fonts[i] as Uint8Array)
    } catch {
      // a bad font shouldn't break the preview; skip it
    }
  }
  engineFontCount.set(engine, fonts.length)
}

export interface PlayerProps {
  /** A `<Composition>` element (from `@onda/react`). */
  composition: ReactElement
  /** Start playing on mount. Default `true`. */
  autoPlay?: boolean
  /** Loop back to frame 0 at the end. Default `true`. Also toggleable in the UI. */
  loop?: boolean
  /**
   * The renderer. The Player auto-selects the best available, in order:
   *   1. an explicit {@link PlayerProps.draw},
   *   2. the GPU engine ({@link PlayerProps.gpuEngine}) — Vello/WebGPU,
   *      pixel-identical to `onda export`,
   *   3. the CPU engine ({@link PlayerProps.engine}),
   *   4. the Canvas2D {@link drawScene} fallback.
   * It also falls back automatically if a renderer errors at runtime.
   */
  draw?: FrameDrawer
  /** The GPU (Vello/WebGPU) renderer — preferred when present (see {@link GpuEngine}). */
  gpuEngine?: GpuEngine
  /** The CPU renderer (`@onda/wasm`'s `OndaEngine`) — fallback when there's no GPU. */
  engine?: RenderEngine
  /** Show a small backend indicator (WebGPU/CPU/Canvas2D). Default `true`. */
  showStatus?: boolean
  /** Control visibility. `'auto'` (default) reveals the controls on hover / focus
   *  / when paused; `'always'` keeps them visible; `'none'` hides them entirely
   *  (no overlay, no fullscreen button, no click-to-toggle) — a chrome-free
   *  thumbnail (e.g. a gallery tile that plays on hover + clicks through to a link). */
  controls?: 'auto' | 'always' | 'none'
  /** Accessible label for the player region. Default `"ONDA composition player"`. */
  label?: string
  /** Optional className on the root for app-level layout/overrides. */
  className?: string
  /** Frame to start on. Default `0`. Clamped to the composition length. */
  initialFrame?: number
  /** Initial playback speed (preview only — does NOT change the exported video,
   *  which always renders 1× at the composition fps). `1` = real-time. Forward
   *  presets in the UI are 0.25×–2×; programmatic values clamp to 0.1×–4×.
   *  Default `1`. */
  playbackRate?: number
  /** Called whenever the current frame changes (scrub or playback). */
  onFrameUpdate?: (frame: number) => void
  /** Called when playback starts. */
  onPlay?: () => void
  /** Called when playback pauses (or stops at the end of a non-looping clip). */
  onPause?: () => void
}

/**
 * Imperative handle for `<Player>` (via `ref`) — drive playback from a host app
 * such as an editor timeline.
 *
 * @example
 * ```tsx
 * const ref = useRef<PlayerHandle>(null)
 * <Player ref={ref} composition={…} />
 * ref.current?.seekTo(48)
 * ```
 */
/** Player events (Remotion-`@remotion/player`-compatible) for a host editor to
 *  sync against — e.g. a canvas overlay tracking the current frame. */
export type PlayerEventType = 'frameupdate' | 'play' | 'pause' | 'seeked' | 'ended' | 'ratechange'

/** Event passed to a {@link PlayerEventListener}: `detail.frame` is the current
 *  frame (mirrors Remotion's `CallbackListener` event shape). For `ratechange`,
 *  `detail.playbackRate` carries the new preview speed. */
export interface PlayerEvent {
  type: PlayerEventType
  detail: { frame: number; playbackRate?: number }
}

export type PlayerEventListener = (event: PlayerEvent) => void

export interface PlayerHandle {
  /** Seek to a frame (clamped). Does not change the play/pause state. */
  seekTo(frame: number): void
  /** Start playing (restarts from 0 if at the end of a non-looping clip). */
  play(): void
  /** Pause playback. */
  pause(): void
  /** Toggle play/pause. */
  toggle(): void
  /** The current frame. */
  getCurrentFrame(): number
  /** Total frames in the composition. */
  getTotalFrames(): number
  /** Whether playback is currently running. */
  isPlaying(): boolean
  /** The current preview playback speed (1 = real-time). */
  getPlaybackRate(): number
  /** Set the preview playback speed (clamped to 0.1×–4×). Preview only — does
   *  not affect export. Emits a `ratechange` event. */
  setPlaybackRate(rate: number): void
  /** Subscribe to a player event
   *  (`frameupdate`/`play`/`pause`/`seeked`/`ended`/`ratechange`).
   *  Mirrors `@remotion/player`'s `addEventListener` so an editor built against
   *  Remotion's Player ports without rewiring its frame-sync/overlay. */
  addEventListener(type: PlayerEventType, listener: PlayerEventListener): void
  /** Unsubscribe a listener previously passed to {@link addEventListener}. */
  removeEventListener(type: PlayerEventType, listener: PlayerEventListener): void
}

/**
 * Render an ONDA composition to a canvas with play/pause, a frame scrubber, a
 * loop toggle, and a frame/time readout.
 *
 * @example
 * ```tsx
 * import { Player } from '@onda/player'
 * <Player composition={<Composition …>…</Composition>} engine={ondaEngine} />
 * ```
 */
export const Player = forwardRef<PlayerHandle, PlayerProps>(function Player(
  {
    composition,
    autoPlay = true,
    loop: initialLoop = true,
    draw,
    gpuEngine,
    engine,
    showStatus = true,
    controls = 'auto',
    label = 'ONDA composition player',
    className,
    initialFrame = 0,
    playbackRate = 1,
    onFrameUpdate,
    onPlay,
    onPause,
  }: PlayerProps,
  ref,
): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  useInjectStyles()

  // If a renderer throws at runtime, drop it and fall back for the rest of the
  // session rather than blanking.
  const [gpuFailed, setGpuFailed] = useState(false)
  const [engineFailed, setEngineFailed] = useState(false)

  // Auto-select the renderer: explicit draw > GPU (Vello) > CPU engine > Canvas2D.
  const mode = useMemo<
    { kind: 'gpu'; engine: GpuEngine } | { kind: 'sync'; draw: FrameDrawer; label: string }
  >(() => {
    if (draw) return { kind: 'sync', draw, label: 'Custom' }
    if (gpuEngine && !gpuFailed) return { kind: 'gpu', engine: gpuEngine }
    if (engine && !engineFailed) {
      const real = engineDrawer(engine)
      const safe: FrameDrawer = (ctx, scene) => {
        try {
          real(ctx, scene)
        } catch {
          setEngineFailed(true)
          drawScene(ctx, scene)
        }
      }
      return { kind: 'sync', draw: safe, label: 'CPU' }
    }
    return { kind: 'sync', draw: drawScene, label: 'Canvas2D' }
  }, [draw, gpuEngine, gpuFailed, engine, engineFailed])

  const backend = mode.kind === 'gpu' ? 'WebGPU' : mode.label
  const isExact = mode.kind === 'gpu' || backend === 'CPU' || backend === 'Custom'

  // Resolution + timing come from rendering frame 0 once.
  const config = useMemo(() => renderFrame(composition, 0).composition, [composition])
  const totalFrames = Math.max(1, config.duration_in_frames)
  const lastFrame = totalFrames - 1

  // `previewFallback: 'element'` video nodes shown as DOM <video> overlays
  // (display-only preview for sources we can't composite, e.g. cross-origin
  // without CORS). Boxes are frame-independent, so derive once per composition.
  const videoOverlays = useMemo(
    () =>
      collectVideoOverlays(renderFrame(composition, 0).root as never, config.width, config.height),
    [composition, config.width, config.height],
  )
  const videoOverlayRef = useRef<HTMLDivElement>(null)

  // Non-visual <Audio> clips to play for preview (frame-independent, so derive
  // once per composition). Played via the Web Audio transport below (decoded
  // buffers on the audio thread — immune to the main-thread render jank that made
  // HTML <audio> glitch).
  const audioClips: AudioClip[] = useMemo(
    () => collectAudioClips(renderFrame(composition, 0).root as never),
    [composition],
  )
  // One Web Audio transport per player. Created lazily (browser-only) so SSR and
  // pre-gesture mounts never spin up an AudioContext.
  const audioRef = useRef<PreviewAudio | null>(null)
  if (audioRef.current === null && typeof window !== 'undefined') {
    audioRef.current = new PreviewAudio()
  }
  useEffect(
    () => () => {
      audioRef.current?.dispose()
      audioRef.current = null
    },
    [],
  )
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)

  const [frame, setFrame] = useState(() =>
    Math.min(lastFrame, Math.max(0, Math.floor(initialFrame))),
  )

  // Resolve image src URLs to data: URIs (the wasm engine can't fetch). Sample a
  // few frames so srcs that only appear later are covered; bumping `imagesReady`
  // re-renders once they're cached so the now-decodable images appear.
  const [imagesReady, setImagesReady] = useState(0)
  useEffect(() => {
    const urls = new Set<string>()
    for (const f of new Set([0, Math.floor(lastFrame / 2), lastFrame])) {
      collectImageUrls(renderFrame(composition, f).root as never, urls)
    }
    if (urls.size === 0) return
    let cancelled = false
    Promise.all([...urls].map(resolveImageUrl)).then(() => {
      if (!cancelled) setImagesReady((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [composition, lastFrame])

  const [playing, setPlaying] = useState(autoPlay)
  const [loop, setLoop] = useState(initialLoop)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // Bumped by every explicit seek (scrubber/keyboard/host), so the audio
  // transport re-anchors only on a real seek — never on normal frame advance.
  const [seekNonce, setSeekNonce] = useState(0)
  // Preview playback speed (1 = real-time). Preview-only: the clock advances
  // `rate`× as fast; export is unaffected. `speedOpen` toggles the preset menu.
  const [rate, setRate] = useState(() => clampRate(playbackRate))
  const [speedOpen, setSpeedOpen] = useState(false)
  const speedRef = useRef<HTMLDivElement>(null)

  // The frame/composition the canvas should show. Updated synchronously each
  // render so the async GPU loop can always pull the latest target. `images` is
  // the resolved-image version so a fetch that lands mid-paint forces a repaint.
  const targetRef = useRef({ composition, frame, images: imagesReady })
  targetRef.current = { composition, frame, images: imagesReady }

  // Vsync-aligned canvas blit: stash the latest rendered pixels and paint them
  // inside ONE requestAnimationFrame, instead of the instant each async
  // `gpu.render` resolves. Aligning canvas writes to the display refresh stops a
  // playing video from tearing against the compositor while the mouse moves
  // (unsynced `putImageData` mid-composite reads as a subtle flash). Only the most
  // recent frame is painted — intermediate frames rendered before the rAF fires
  // are dropped, which is correct for smooth playback.
  const pendingPaintRef = useRef<{ width: number; height: number; pixels: Uint8Array } | null>(null)
  const blitRafRef = useRef<number | null>(null)
  const scheduleBlit = useCallback((out: { width: number; height: number; pixels: Uint8Array }) => {
    pendingPaintRef.current = out
    if (blitRafRef.current != null) return
    blitRafRef.current = requestAnimationFrame(() => {
      blitRafRef.current = null
      const p = pendingPaintRef.current
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!p || !canvas || !ctx) return
      if (canvas.width !== p.width) canvas.width = p.width
      if (canvas.height !== p.height) canvas.height = p.height
      ctx.putImageData(new ImageData(new Uint8ClampedArray(p.pixels), p.width, p.height), 0, 0)
    })
  }, [])
  useEffect(
    () => () => {
      if (blitRafRef.current != null) cancelAnimationFrame(blitRafRef.current)
    },
    [],
  )

  // Latest values for the imperative handle + event callbacks, read from refs so
  // the handle/effects don't re-subscribe on every frame.
  const liveRef = useRef({ frame, playing, loop, lastFrame, totalFrames, rate })
  liveRef.current = { frame, playing, loop, lastFrame, totalFrames, rate }
  const onFrameUpdateRef = useRef(onFrameUpdate)
  onFrameUpdateRef.current = onFrameUpdate
  const onPlayRef = useRef(onPlay)
  onPlayRef.current = onPlay
  const onPauseRef = useRef(onPause)
  onPauseRef.current = onPause

  // Remotion-style event listeners (addEventListener on the handle). Held in a
  // ref so subscribing doesn't re-render; emitted from the same effects that
  // fire the callback props.
  const listenersRef = useRef<Map<PlayerEventType, Set<PlayerEventListener>>>(new Map())
  const emit = useCallback((type: PlayerEventType, atFrame: number, playbackRate?: number) => {
    const set = listenersRef.current.get(type)
    if (!set) return
    const detail =
      playbackRate === undefined ? { frame: atFrame } : { frame: atFrame, playbackRate }
    for (const listener of set) listener({ type, detail })
  }, [])

  // Change the preview speed (clamped), notifying listeners. Read by the rAF
  // clock + the audio sync via `liveRef.current.rate`, so changing speed never
  // tears down the playback loop.
  const changeRate = useCallback(
    (next: number) => {
      const clamped = clampRate(next)
      setRate(clamped)
      emit('ratechange', liveRef.current.frame, clamped)
    },
    [emit],
  )

  // Close the speed menu on an outside click or Escape.
  useEffect(() => {
    if (!speedOpen) return
    const onDown = (e: Event) => {
      if (!speedRef.current?.contains(e.target as Node)) setSpeedOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setSpeedOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [speedOpen])

  // Single-flight async GPU paint: render the latest target, dropping any
  // intermediate frames (the readback can't always keep up at 60fps). The busy
  // flag is keyed on the ENGINE (module-level {@link enginesRendering}), not this
  // component — so multiple <Player>s sharing one engine (e.g. a gallery that
  // remounts on switch) never call its `&mut render()` re-entrantly (wasm:
  // "recursive use of an object … unsafe aliasing in rust").
  const paintGpu = useCallback(
    (gpu: GpuEngine) => {
      if (enginesRendering.has(gpu)) return
      enginesRendering.add(gpu)
      ;(async () => {
        try {
          let done: { c: ReactElement; f: number; v: number } | null = null
          while (true) {
            const { composition: c, frame: f, images: v } = targetRef.current
            // Caught up only if the frame/composition AND the resolved-image
            // version are unchanged — so an image that finishes fetching mid-paint
            // repaints even though the composition + frame are the same.
            if (done && done.c === c && done.f === f && done.v === v) break
            done = { c, f, v }
            const scene = renderFrame(c, f)
            applyResolvedImages(scene.root as never)
            // Decode the current frame of any <Video> node (browser-side) and
            // attach it before rendering — a video's pixels change every frame.
            await resolveVideoFrames(scene.root as never)
            // Load any custom fonts the composition registered (via `loadFont`) into
            // this engine before drawing, so preview matches export. No-op once warm.
            ensureFontsLoaded(gpu)
            const out = await gpu.render(JSON.stringify(scene))
            // Paint on the next animation frame (vsync-aligned), not inline — see
            // `scheduleBlit`. Keeps the video repaint from tearing under mouse-move.
            scheduleBlit(out)
          }
        } catch {
          setGpuFailed(true) // drop to the next renderer
        } finally {
          enginesRendering.delete(gpu)
        }
      })()
    },
    [scheduleBlit],
  )

  // Re-draw whenever the frame, composition, or renderer changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: paint fns are stable refs; deps list the real triggers
  useEffect(() => {
    if (mode.kind === 'gpu') {
      paintGpu(mode.engine)
    } else {
      const ctx = canvasRef.current?.getContext('2d')
      if (ctx) {
        const scene = renderFrame(composition, frame)
        applyResolvedImages(scene.root as never)
        mode.draw(ctx, scene)
      }
    }
    // `imagesReady` is a dep so the frame repaints once images resolve.
  }, [composition, frame, mode, paintGpu, imagesReady])

  // Keep the `previewFallback: 'element'` overlay <video>s in lockstep with the
  // player's play/pause. (They aren't frame-locked to the timeline — a display-
  // only preview — but at least they pause when the composition pauses.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-queries the DOM each run; playing is the only trigger
  useEffect(() => {
    const vids = videoOverlayRef.current?.querySelectorAll('video')
    if (!vids) return
    for (const v of vids) {
      if (playing) void v.play().catch(() => {})
      else v.pause()
    }
  }, [playing, videoOverlays])

  // ── Web Audio transport ──────────────────────────────────────────────────
  // The clips/period feed the transport; play/pause/seek/rate/volume drive it.
  // Note the conspicuous absence of a per-`frame` effect: the audio runs on the
  // AudioContext clock anchored at play-time, NOT chasing the visual frame each
  // tick — that's what keeps it gapless and jank-proof.
  const compSeconds = useCallback((f: number) => f / Math.max(1, config.fps), [config.fps])

  // Clip set + timeline period (one loop cycle, seconds).
  useEffect(() => {
    audioRef.current?.setClips(audioClips, totalFrames / Math.max(1, config.fps))
  }, [audioClips, totalFrames, config.fps])

  // Master volume / mute (click-free ramp inside the engine).
  useEffect(() => {
    audioRef.current?.setGain(volume, muted)
  }, [volume, muted])

  useEffect(() => {
    audioRef.current?.setLoop(loop)
  }, [loop])

  // Preview speed: the engine re-anchors and plays silent at ≠ 1× (raw rate would
  // pitch-shift), audible again at 1×.
  useEffect(() => {
    audioRef.current?.setRate(rate)
  }, [rate])

  // Play / pause — anchor at the current playhead on play, stop on pause. The
  // playhead is read live (not from the `frame` closure) so it's exact at the
  // moment play starts.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) audio.play(compSeconds(liveRef.current.frame))
    else audio.pause()
  }, [playing, compSeconds])

  // Re-anchor on an explicit seek (bumped by seekTo/goToFrame) — but only while
  // playing; a paused seek just records the position for the next play. Normal
  // playback advances `frame` without bumping this, so the audio is never yanked.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seekNonce is the intentional trigger; refs carry live state
  useEffect(() => {
    if (liveRef.current.playing) audioRef.current?.seek(compSeconds(liveRef.current.frame))
  }, [seekNonce, compSeconds])

  // Playback paced to the composition's fps via requestAnimationFrame, scaled by
  // the preview `rate` (read live from the ref — `rate > 1` skips frames, `< 1`
  // holds them; the renderer just draws whatever frame the clock lands on).
  useEffect(() => {
    if (!playing) return
    const frameDuration = 1000 / config.fps
    let last: number | null = null
    let raf = 0
    const tick = (now: number) => {
      if (last === null) last = now
      const r = liveRef.current.rate
      const steps = Math.floor(((now - last) * r) / frameDuration)
      if (steps > 0) {
        // Advance `last` by exactly the time consumed (NOT to `now`), so the
        // sub-frame remainder carries over instead of being discarded. Discarding
        // it biased the clock slow under jank, letting the audio (real-time on the
        // AudioContext clock) drift ahead of the visual.
        last += (steps * frameDuration) / r
        setFrame((current) => {
          const next = current + steps
          if (next <= lastFrame) return next
          return loop ? next % totalFrames : lastFrame
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, config.fps, totalFrames, lastFrame, loop])

  // Stop at the end when not looping (and emit `ended`).
  useEffect(() => {
    if (!loop && frame >= lastFrame) {
      setPlaying(false)
      emit('ended', frame)
    }
  }, [frame, lastFrame, loop, emit])

  // Emit frame/play/pause events for host apps (e.g. an editor syncing an
  // overlay to the composition), both via the callback props and the
  // addEventListener API. Refs keep a changing callback from re-subscribing.
  useEffect(() => {
    onFrameUpdateRef.current?.(frame)
    emit('frameupdate', frame)
  }, [frame, emit])
  useEffect(() => {
    if (playing) onPlayRef.current?.()
    else onPauseRef.current?.()
    emit(playing ? 'play' : 'pause', liveRef.current.frame)
  }, [playing, emit])

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      // Restart from 0 if pressing play at the end of a non-looping clip.
      if (!p && !loop && frame >= lastFrame) setFrame(0)
      return !p
    })
  }, [loop, frame, lastFrame])

  const seekTo = useCallback(
    (next: number) => {
      setPlaying(false)
      setFrame(Math.min(lastFrame, Math.max(0, next)))
      setSeekNonce((n) => n + 1)
    },
    [lastFrame],
  )

  // Programmatic seek (imperative handle): clamp + set, WITHOUT pausing — a host
  // editor may scrub while playing. (The UI scrubber/keyboard use the pausing
  // `seekTo` above.)
  const goToFrame = useCallback(
    (next: number) => {
      const clamped = Math.min(lastFrame, Math.max(0, Math.floor(next)))
      setFrame(clamped)
      setSeekNonce((n) => n + 1)
      emit('seeked', clamped)
    },
    [lastFrame, emit],
  )

  // Imperative API for host apps driving playback (e.g. an editor timeline).
  useImperativeHandle(
    ref,
    () => ({
      seekTo: goToFrame,
      play: () => {
        const { frame: f, loop: lp, lastFrame: lf } = liveRef.current
        if (!lp && f >= lf) setFrame(0) // restart a finished non-looping clip
        setPlaying(true)
      },
      pause: () => setPlaying(false),
      toggle: togglePlay,
      getCurrentFrame: () => liveRef.current.frame,
      getTotalFrames: () => liveRef.current.totalFrames,
      isPlaying: () => liveRef.current.playing,
      getPlaybackRate: () => liveRef.current.rate,
      setPlaybackRate: changeRate,
      addEventListener: (type, listener) => {
        const map = listenersRef.current
        if (!map.has(type)) map.set(type, new Set())
        map.get(type)?.add(listener)
      },
      removeEventListener: (type, listener) => {
        listenersRef.current.get(type)?.delete(listener)
      },
    }),
    [goToFrame, togglePlay, changeRate],
  )

  // Fullscreen the stage (canvas + controls). Uses the standard API with a
  // WebKit fallback so it works in Safari too.
  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => void })
      | null
    if (!el) return
    const doc = document as Document & {
      webkitFullscreenElement?: Element
      webkitExitFullscreen?: () => void
    }
    if (document.fullscreenElement ?? doc.webkitFullscreenElement) {
      ;(document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document)
    } else {
      ;(el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el)
    }
  }, [])

  // Track fullscreen state so the icon/label reflect it.
  useEffect(() => {
    const onChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element }
      setIsFullscreen(Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement))
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [])

  // Keyboard: Space = play/pause, arrows = step (Shift = jump 10), Home/End.
  // The handler lives on the focusable region so it works from anywhere in the
  // player. When a native <button> has focus, the browser already activates it
  // on Space/Enter — so we skip Space there to avoid a double toggle.
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const onButton = (event.target as HTMLElement)?.tagName === 'BUTTON'
      const jump = event.shiftKey ? 10 : 1
      switch (event.key) {
        case ' ':
        case 'k':
          if (onButton && event.key === ' ') return // let the button handle it
          event.preventDefault()
          togglePlay()
          break
        case 'ArrowRight':
          event.preventDefault()
          seekTo(frame + jump)
          break
        case 'ArrowLeft':
          event.preventDefault()
          seekTo(frame - jump)
          break
        case 'Home':
          event.preventDefault()
          seekTo(0)
          break
        case 'End':
          event.preventDefault()
          seekTo(lastFrame)
          break
        case 'l':
          event.preventDefault()
          setLoop((v) => !v)
          break
        case 'f':
          event.preventDefault()
          toggleFullscreen()
          break
      }
    },
    [frame, lastFrame, togglePlay, seekTo, toggleFullscreen],
  )

  const seconds = frame / config.fps
  const totalSeconds = lastFrame / config.fps

  // Small corner badge: the active backend + a fuller description (tooltip).
  const statusLabel = backend
  const statusText =
    mode.kind === 'gpu'
      ? 'Rendered by Vello on WebGPU — pixel-identical to `onda export`, no Chromium.'
      : backend === 'CPU'
        ? 'Rendered by the ONDA CPU engine in WebAssembly — no DOM, no Chromium.'
        : backend === 'Canvas2D'
          ? 'Canvas2D fallback — WebGPU and the CPU engine are unavailable here.'
          : 'Custom renderer.'

  return (
    <div
      className={[
        'onda-player',
        playing ? '' : 'is-paused',
        controls === 'always' ? 'is-controls' : '',
        controls === 'none' ? 'is-controls-none' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={styles.root}
      // biome-ignore lint/a11y/useSemanticElements: a media-player region; no semantic element exists for it
      role="group"
      aria-label={label}
      aria-roledescription="media player"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the player root IS the keyboard surface (Space/arrows/Home/End)
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {/* The stage is the positioning context: canvas fills it, controls overlay
          on top (auto-hidden unless hovering / paused / keyboard-focused). */}
      <div
        ref={stageRef}
        className="onda-player__stage"
        style={{ ...styles.stage, aspectRatio: `${config.width} / ${config.height}` }}
      >
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard play/pause lives on the player root (Space) */}
        <canvas
          ref={canvasRef}
          width={config.width}
          height={config.height}
          className="onda-player__canvas"
          style={styles.canvas}
          onClick={controls === 'none' ? undefined : togglePlay}
          aria-label={`composition preview, ${config.width}×${config.height} at ${config.fps}fps — click to ${playing ? 'pause' : 'play'}`}
        />

        {/* Display-only <video> overlay for `previewFallback: 'element'` sources
            (cross-origin without CORS). Above the canvas, click-through. */}
        {videoOverlays.length > 0 && (
          <div ref={videoOverlayRef} style={styles.videoOverlay} aria-hidden="true">
            {videoOverlays.map((o) => (
              <video
                key={o.key}
                src={o.src}
                muted
                autoPlay
                loop
                playsInline
                style={{
                  position: 'absolute',
                  left: `${(o.x / config.width) * 100}%`,
                  top: `${(o.y / config.height) * 100}%`,
                  width: `${(o.w / config.width) * 100}%`,
                  height: `${(o.h / config.height) * 100}%`,
                  objectFit: o.fit,
                }}
              />
            ))}
          </div>
        )}

        {showStatus && (
          <div className="onda-player__badge" title={statusText}>
            <span
              className={`onda-player__dot onda-player__dot--${isExact ? 'ok' : 'warn'}`}
              aria-hidden="true"
            />
            <span>{statusLabel}</span>
          </div>
        )}

        <button
          type="button"
          className="onda-player__fs"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
          aria-pressed={isFullscreen}
          title={isFullscreen ? 'Exit full screen (f)' : 'Full screen (f)'}
        >
          {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        </button>

        <div className="onda-player__overlay">
          <input
            id={`${uid}-scrubber`}
            type="range"
            className="onda-player__scrubber"
            style={
              { '--progress': `${lastFrame ? (frame / lastFrame) * 100 : 0}%` } as CSSProperties
            }
            min={0}
            max={lastFrame}
            step={1}
            value={frame}
            onChange={(event) => seekTo(Number(event.target.value))}
            aria-label="Seek frame"
            aria-valuemin={0}
            aria-valuemax={lastFrame}
            aria-valuenow={frame}
            aria-valuetext={`Frame ${frame} of ${lastFrame}, ${seconds.toFixed(2)} seconds`}
          />

          <div className="onda-player__row">
            <button
              type="button"
              className="onda-player__play"
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              aria-pressed={playing}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>

            <output
              className="onda-player__readout"
              htmlFor={`${uid}-scrubber`}
              style={styles.readout}
              aria-live="off"
            >
              <span className="onda-player__time">{fmtTime(seconds)}</span>
              <span className="onda-player__sep" aria-hidden="true">
                /
              </span>
              <span className="onda-player__total">{fmtTime(totalSeconds)}</span>
            </output>

            <span className="onda-player__spacer" />

            {audioClips.length > 0 && (
              <div className="onda-player__volume">
                <button
                  type="button"
                  className="onda-player__icon"
                  onClick={() => setMuted((v) => !v)}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  aria-pressed={muted}
                  title={muted ? 'Unmute' : 'Mute'}
                >
                  {muted || volume === 0 ? <VolumeMuteIcon /> : <VolumeIcon />}
                </button>
                <input
                  type="range"
                  className="onda-player__volume-slider"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(event) => {
                    const v = Number(event.target.value)
                    setVolume(v)
                    setMuted(v === 0)
                  }}
                  aria-label="Volume"
                />
              </div>
            )}

            <div className="onda-player__speed" ref={speedRef}>
              <button
                type="button"
                className={`onda-player__icon onda-player__speed-btn${rate !== 1 ? ' is-active' : ''}`}
                onClick={() => setSpeedOpen((v) => !v)}
                aria-label={`Playback speed: ${formatRate(rate)}`}
                aria-haspopup="menu"
                aria-expanded={speedOpen}
                title="Playback speed (preview only)"
              >
                {formatRate(rate)}
              </button>
              {speedOpen && (
                <div className="onda-player__speed-menu" role="menu" aria-label="Playback speed">
                  {SPEED_PRESETS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="menuitemradio"
                      aria-checked={r === rate}
                      className={`onda-player__speed-item${r === rate ? ' is-active' : ''}`}
                      onClick={() => {
                        changeRate(r)
                        setSpeedOpen(false)
                      }}
                    >
                      {formatRate(r)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              className={`onda-player__icon${loop ? ' is-active' : ''}`}
              onClick={() => setLoop((v) => !v)}
              aria-label="Loop playback"
              aria-pressed={loop}
              title="Loop"
            >
              <LoopIcon />
            </button>
          </div>
        </div>
        {/* Audio is played via the Web Audio transport (see the effects above), not
            DOM <audio> elements — decoded buffers on the audio thread stay glitch-
            free under the main-thread render load. */}
      </div>
    </div>
  )
})

/** Preview-speed presets shown in the speed menu (forward only; 1 = real-time). */
const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2] as const

/** Clamp a programmatic playback rate to the supported preview range. */
function clampRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1
  return Math.max(0.1, Math.min(4, rate))
}

/** Format a rate for the UI, e.g. `0.5×`, `1×`, `1.5×` (≤2 decimals). */
function formatRate(rate: number): string {
  return `${Math.round(rate * 100) / 100}×`
}

function PlayIcon(): ReactElement {
  return (
    <svg width="15" height="16" viewBox="0 0 15 16" fill="currentColor" aria-hidden="true">
      <path d="M2 1.4v13.2a1 1 0 0 0 1.52.85l11-6.6a1 1 0 0 0 0-1.7l-11-6.6A1 1 0 0 0 2 1.4Z" />
    </svg>
  )
}

function PauseIcon(): ReactElement {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor" aria-hidden="true">
      <rect x="2" y="1.5" width="3.5" height="13" rx="1.2" />
      <rect x="8.5" y="1.5" width="3.5" height="13" rx="1.2" />
    </svg>
  )
}

function LoopIcon(): ReactElement {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 1.5 21 5.5 17 9.5" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22.5 3 18.5 7 14.5" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  )
}

function VolumeIcon(): ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M16.5 8.5a4 4 0 0 1 0 7" />
      <path d="M19 6a7 7 0 0 1 0 12" />
    </svg>
  )
}

function VolumeMuteIcon(): ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M22 9.5 16.5 15" />
      <path d="M16.5 9.5 22 15" />
    </svg>
  )
}

function FullscreenIcon(): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8V4a1 1 0 0 1 1-1h4" />
      <path d="M21 8V4a1 1 0 0 0-1-1h-4" />
      <path d="M3 16v4a1 1 0 0 0 1 1h4" />
      <path d="M21 16v4a1 1 0 0 1-1 1h-4" />
    </svg>
  )
}

function ExitFullscreenIcon(): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3v4a1 1 0 0 1-1 1H3" />
      <path d="M16 3v4a1 1 0 0 0 1 1h4" />
      <path d="M8 21v-4a1 1 0 0 0-1-1H3" />
      <path d="M16 21v-4a1 1 0 0 1 1-1h4" />
    </svg>
  )
}

/** Format seconds as `m:ss.cs` (tabular-friendly). */
function fmtTime(s: number): string {
  const minutes = Math.floor(s / 60)
  const secs = Math.floor(s % 60)
  const centis = Math.floor((s * 100) % 100)
  return `${minutes}:${secs.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`
}

/** Inline-styled fallbacks (work even without the stylesheet). The stylesheet
 *  below layers brand tokens, hover/focus, and reduced-motion on top. */
const styles: Record<string, CSSProperties> = {
  root: {
    display: 'block',
    width: '100%',
    color: 'var(--onda-text, #f2f2f4)',
    fontFamily: 'var(--onda-font-body, "Space Grotesk", ui-sans-serif, system-ui, sans-serif)',
  },
  stage: {
    position: 'relative',
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    background: 'var(--onda-bg-deep, #08080a)',
    border: '1px solid var(--onda-border, #26262c)',
    // Isolate the preview as its own compositing context + contain its paint, so
    // the heavy, per-frame-updating canvas layer doesn't force the browser to
    // recomposite the whole PAGE behind it. That recomposite is what flickers the
    // background on some GPUs (e.g. Arc/Metal) while a video plays and the cursor
    // moves — a compositor artifact, NOT a content change (the rendered frames are
    // byte-identical) and NOT present in exported video.
    isolation: 'isolate',
    contain: 'paint',
    // A query container (inline axis only, so aspect-ratio still drives height) so
    // the control bar can adapt to narrow widths (e.g. 9:16) — see the @container
    // rule in the stylesheet.
    containerType: 'inline-size',
  },
  // `translateZ(0)` promotes the canvas to its OWN GPU layer, so its per-frame
  // pixel updates don't invalidate / re-raster sibling layers (see `stage`).
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block',
    cursor: 'pointer',
    transform: 'translateZ(0)',
  },
  videoOverlay: { position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' },
  readout: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 4,
    fontVariantNumeric: 'tabular-nums',
    fontSize: 13,
    color: 'rgba(255,255,255,.75)',
    whiteSpace: 'nowrap',
  },
}

/** Inject the player's stylesheet once into `<head>`, persistently. A real
 *  stylesheet (not inline styles) lets us style `:hover`, `:focus-visible`, the
 *  range thumb/track, `:fullscreen`, and honor `prefers-reduced-motion`.
 *
 *  It lives in `<head>` — NOT the component tree — so it survives the player
 *  unmounting/remounting. (The gallery swaps compositions via `key`, which would
 *  otherwise tear out an in-tree `<style>` and leave every player after the first
 *  unstyled — no visible controls.) */
function useInjectStyles(): void {
  useEffect(() => {
    const id = 'onda-player-styles'
    if (typeof document === 'undefined' || document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = PLAYER_CSS
    document.head.appendChild(style)
  }, [])
}

const PLAYER_CSS = `
.onda-player {
  /* Brand tokens (onda.video palette) with safe fallbacks. */
  --onda-bg: var(--bg, #0e0e12);
  --onda-bg-deep: var(--bg-deep, #08080a);
  --onda-surface: var(--surface, #121217);
  --onda-surface-2: var(--surface-2, #18181d);
  --onda-border: var(--border, #26262c);
  --onda-text: var(--text, #f2f2f4);
  --onda-text-muted: var(--text-muted, #8e8e98);
  /* Player-scoped (NOT the page's generic --accent, which a host app like ONDA
     Studio sets to its own color) so the controls stay the ONDA rose by default;
     a host can still theme them via --onda-player-accent. */
  --onda-accent: var(--onda-player-accent, #d96b82);
  --onda-accent-600: var(--onda-player-accent-600, #c8576f);
  --onda-on-accent: var(--on-accent, #0e0e12);
  --onda-ok: var(--ok, #6bbf8a);
  --onda-warn: var(--warn, #d9b06b);
}
/* Controls overlay the stage and auto-hide unless hovering / paused / focused. */
.onda-player__overlay {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; flex-direction: column; gap: 10px;
  padding: 32px 14px 14px;
  background: linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,.32) 55%, transparent);
  opacity: 0; transform: translateY(8px);
  transition: opacity 200ms ease-out, transform 200ms ease-out;
  pointer-events: none;
}
.onda-player__stage:hover .onda-player__overlay,
.onda-player__stage:focus-within .onda-player__overlay,
.onda-player.is-paused .onda-player__overlay,
.onda-player.is-controls .onda-player__overlay {
  opacity: 1; transform: none; pointer-events: auto;
}
/* controls:none — a chrome-free thumbnail: no overlay, no fullscreen button
   (overrides the hover/focus/paused reveal above). */
.onda-player.is-controls-none .onda-player__overlay,
.onda-player.is-controls-none .onda-player__fs {
  display: none;
}
.onda-player__row { display: flex; align-items: center; gap: 14px; }
.onda-player__spacer { flex: 1 1 auto; }
/* Responsive control bar — the overlay is an inline-size query container, so
   these adapt to the PLAYER width regardless of canvas aspect (9:16, 4:5, 1:1,
   16:9 all just resolve to a width).

   KEY: the widest thing in the bar is the time readout ("0:07.80 / 0:11.06"),
   NOT the buttons — so the right move on a narrow player is to compact the TIME,
   which then lets every button (play · mute · speed · loop) stay in one row. We
   only start dropping controls at sizes far below any real editor preview.

   Tier 1 (≤440px — most 9:16 / smaller 4:5·1:1): readout → CURRENT time only
     (the scrubber already shows the end point), tighten gaps. All buttons stay.
   Tier 2 (≤340px — tight 9:16): collapse volume to a mute TOGGLE (its 56px
     hover-out slider is the only thing left that would overflow). Muting works.
   Tier 3 (≤280px — last resort, a very small player): drop the preview-only
     speed control. */
@container (max-width: 440px) {
  .onda-player__overlay { padding-left: 12px; padding-right: 12px; }
  .onda-player__row { gap: 9px; }
  .onda-player__sep, .onda-player__total { display: none; }
}
@container (max-width: 340px) {
  .onda-player__overlay { padding-left: 9px; padding-right: 9px; }
  .onda-player__row { gap: 7px; }
  .onda-player__volume-slider { display: none; }
}
@container (max-width: 280px) {
  .onda-player__speed { display: none; }
}
/* Engine/preview badge (top-left), fades with the controls. */
.onda-player__badge {
  position: absolute; top: 12px; left: 12px;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 10px; border-radius: 999px;
  background: rgba(8,8,10,.82);
  border: 1px solid rgba(255,255,255,.1);
  color: rgba(255,255,255,.85);
  font-size: 11.5px; font-weight: 500; letter-spacing: 0.02em;
  opacity: 0; transition: opacity 200ms ease-out; pointer-events: none;
}
.onda-player__stage:hover .onda-player__badge,
.onda-player__stage:focus-within .onda-player__badge,
.onda-player.is-paused .onda-player__badge,
.onda-player.is-controls .onda-player__badge { opacity: 1; }
/* Fullscreen toggle (top-right), fades in with the controls like the badge. */
.onda-player__fs {
  position: absolute; top: 12px; right: 12px;
  width: 34px; height: 34px;
  display: grid; place-items: center;
  border-radius: 9px;
  background: rgba(8,8,10,.82);
  border: 1px solid rgba(255,255,255,.1);
  color: rgba(255,255,255,.85);
  cursor: pointer;
  opacity: 0; transform: translateY(-4px);
  transition: opacity 200ms ease-out, transform 200ms ease-out, background 160ms ease-out, color 160ms ease-out;
  pointer-events: none;
}
.onda-player__stage:hover .onda-player__fs,
.onda-player__stage:focus-within .onda-player__fs,
.onda-player.is-paused .onda-player__fs,
.onda-player.is-controls .onda-player__fs { opacity: 1; transform: none; pointer-events: auto; }
.onda-player__fs:hover { background: rgba(8,8,10,.85); color: #fff; }
.onda-player__fs:focus-visible { outline: 2px solid var(--onda-accent); outline-offset: 2px; }
.onda-player__fs svg { display: block; }
/* In fullscreen: fill the screen and letterbox the canvas (preserve aspect). */
.onda-player__stage:fullscreen,
.onda-player__stage:-webkit-full-screen {
  width: 100vw; height: 100vh; border-radius: 0; aspect-ratio: auto; background: #000;
}
.onda-player__stage:fullscreen .onda-player__canvas,
.onda-player__stage:-webkit-full-screen .onda-player__canvas {
  width: 100vw; height: 100vh; object-fit: contain;
}
/* Circular primary play/pause — the player's focal control. */
.onda-player__play {
  flex: 0 0 auto;
  width: 42px; height: 42px;
  display: grid; place-items: center;
  border: 0; border-radius: 999px;
  background: var(--onda-accent);
  color: var(--onda-on-accent);
  cursor: pointer;
  transition: background 160ms ease-out, transform 120ms ease-out;
}
.onda-player__play:hover { background: var(--onda-accent-600); transform: scale(1.06); }
.onda-player__play:active { transform: scale(0.96); }
.onda-player__play svg { display: block; }
/* Ghost icon toggle (loop), over the scrim. */
.onda-player__icon {
  flex: 0 0 auto;
  width: 36px; height: 36px;
  display: grid; place-items: center;
  border: 1px solid rgba(255,255,255,.18); border-radius: 10px;
  background: transparent; color: rgba(255,255,255,.8);
  cursor: pointer;
  transition: background 160ms ease-out, color 160ms ease-out, border-color 160ms ease-out;
}
.onda-player__icon:hover { background: rgba(255,255,255,.1); color: #fff; }
.onda-player__icon.is-active {
  color: var(--onda-accent);
  border-color: color-mix(in srgb, var(--onda-accent) 60%, transparent);
  background: color-mix(in srgb, var(--onda-accent) 16%, transparent);
}
.onda-player__icon svg { display: block; }
/* Speed: a rate button (shows e.g. "1×") that opens a preset menu above it. */
.onda-player__speed { position: relative; display: inline-flex; flex: 0 0 auto; }
.onda-player__speed-btn {
  width: auto; min-width: 46px; padding: 0 10px;
  font: 600 13px/1 ui-monospace, "SF Mono", Menlo, monospace;
  font-variant-numeric: tabular-nums;
}
.onda-player__speed-menu {
  position: absolute; bottom: calc(100% + 8px); right: 0; z-index: 6;
  display: flex; flex-direction: column; gap: 2px;
  padding: 4px; border-radius: 10px;
  background: #16161c; border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 10px 30px rgba(0,0,0,.5);
}
.onda-player__speed-item {
  appearance: none; border: 0; background: transparent;
  color: rgba(255,255,255,.82); cursor: pointer;
  font: 600 13px/1 ui-monospace, "SF Mono", Menlo, monospace;
  font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap;
  padding: 7px 12px; border-radius: 7px; min-width: 60px;
}
.onda-player__speed-item:hover { background: rgba(255,255,255,.1); color: #fff; }
.onda-player__speed-item.is-active { color: var(--onda-accent); }
.onda-player__speed-btn:focus-visible,
.onda-player__speed-item:focus-visible {
  outline: 2px solid var(--onda-accent); outline-offset: 2px;
}
/* Volume: a mute toggle + a slider that expands on hover/focus (compact). */
.onda-player__volume { display: inline-flex; align-items: center; gap: 4px; }
.onda-player__volume-slider {
  width: 0; opacity: 0; min-width: 0;
  height: 5px; cursor: pointer; margin: 0;
  -webkit-appearance: none; appearance: none; background: transparent;
  transition: width 160ms ease-out, opacity 160ms ease-out;
}
.onda-player__volume:hover .onda-player__volume-slider,
.onda-player__volume:focus-within .onda-player__volume-slider { width: 56px; opacity: 1; }
.onda-player__volume-slider::-webkit-slider-runnable-track {
  height: 4px; border-radius: 999px; background: rgba(255,255,255,.32);
}
.onda-player__volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 11px; height: 11px; margin-top: -3.5px;
  border-radius: 999px; background: #fff;
}
.onda-player__volume-slider::-moz-range-track {
  height: 4px; border-radius: 999px; background: rgba(255,255,255,.32);
}
.onda-player__volume-slider::-moz-range-thumb {
  width: 11px; height: 11px; border: 0; border-radius: 999px; background: #fff;
}
/* Visible focus rings on every interactive control + the player region. */
.onda-player:focus-visible,
.onda-player__play:focus-visible,
.onda-player__icon:focus-visible,
.onda-player__scrubber:focus-visible {
  outline: 2px solid var(--onda-accent);
  outline-offset: 2px;
}
/* Progress-aware scrubber over the scrim: rose fill, translucent track. */
.onda-player__scrubber {
  flex: 1 1 auto; min-width: 80px;
  height: 8px; cursor: pointer; margin: 0;
  -webkit-appearance: none; appearance: none;
  background: transparent;
}
.onda-player__scrubber::-webkit-slider-runnable-track {
  height: 6px; border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--onda-accent) 0 var(--progress, 0%),
    rgba(255,255,255,.32) var(--progress, 0%) 100%
  );
}
.onda-player__scrubber::-moz-range-track {
  height: 6px; border-radius: 999px; background: rgba(255,255,255,.32);
}
.onda-player__scrubber::-moz-range-progress {
  height: 6px; border-radius: 999px; background: var(--onda-accent);
}
.onda-player__scrubber::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 14px; height: 14px; margin-top: -4px;
  border-radius: 999px; background: #fff;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--onda-accent) 45%, transparent), 0 1px 3px rgba(0,0,0,.6);
  transition: box-shadow 140ms ease-out;
}
.onda-player__scrubber:hover::-webkit-slider-thumb {
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--onda-accent) 50%, transparent), 0 1px 3px rgba(0,0,0,.6);
}
.onda-player__scrubber::-moz-range-thumb {
  width: 14px; height: 14px; border: 0;
  border-radius: 999px; background: #fff;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--onda-accent) 45%, transparent), 0 1px 3px rgba(0,0,0,.6);
}
.onda-player__readout { flex: 0 0 auto; }
.onda-player__time { font-weight: 600; color: #fff; }
.onda-player__sep, .onda-player__total { color: rgba(255,255,255,.6); }
.onda-player__dot {
  flex: 0 0 auto; width: 7px; height: 7px; border-radius: 999px; display: inline-block;
}
.onda-player__dot--ok {
  background: var(--onda-ok);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--onda-ok) 25%, transparent);
}
.onda-player__dot--warn {
  background: var(--onda-warn);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--onda-warn) 25%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .onda-player__overlay,
  .onda-player__badge,
  .onda-player__play,
  .onda-player__icon,
  .onda-player__scrubber::-webkit-slider-thumb { transition: none; }
  .onda-player__play:hover,
  .onda-player__play:active { transform: none; }
}
`
