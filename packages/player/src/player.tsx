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

import { renderFrame } from '@onda/react'
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { type FrameDrawer, drawScene } from './canvas-renderer.js'
import { type RenderEngine, engineDrawer } from './engine-drawer.js'

export interface PlayerProps {
  /** A `<Composition>` element (from `@onda/react`). */
  composition: ReactElement
  /** Start playing on mount. Default `true`. */
  autoPlay?: boolean
  /** Loop back to frame 0 at the end. Default `true`. Also toggleable in the UI. */
  loop?: boolean
  /**
   * How to paint each frame.
   *
   * Resolution order:
   *   1. an explicit `draw` (highest priority),
   *   2. else a drawer built from `engine` (the **real**, pixel-exact renderer),
   *   3. else the Canvas2D {@link drawScene} preview (graceful fallback).
   */
  draw?: FrameDrawer
  /**
   * The real ONDA renderer (`@onda/wasm`'s `OndaEngine`). When provided (and no
   * explicit `draw` is given), the player previews through it — pixel-identical
   * to `onda export`. Accepted structurally so `@onda/player` needn't depend on
   * `@onda/wasm`.
   */
  engine?: RenderEngine
  /** Show the brand "engine vs preview" caption under the controls. Default `true`. */
  showStatus?: boolean
  /** Accessible label for the player region. Default `"ONDA composition player"`. */
  label?: string
  /** Optional className on the root for app-level layout/overrides. */
  className?: string
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
export function Player({
  composition,
  autoPlay = true,
  loop: initialLoop = true,
  draw,
  engine,
  showStatus = true,
  label = 'ONDA composition player',
  className,
}: PlayerProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const uid = useId()

  // If the real engine ever throws (e.g. a scene feature its build predates),
  // we fall back to Canvas2D for the rest of the session rather than blanking.
  const [engineFailed, setEngineFailed] = useState<string | null>(null)

  // Pick the frame drawer: explicit > real engine > Canvas2D fallback.
  const paint = useMemo<FrameDrawer>(() => {
    if (draw) return draw
    if (engine && !engineFailed) {
      const real = engineDrawer(engine)
      // Wrap so a render error degrades gracefully instead of crashing React.
      return (ctx, scene) => {
        try {
          real(ctx, scene)
        } catch (err) {
          setEngineFailed(err instanceof Error ? err.message : String(err))
          drawScene(ctx, scene) // best-effort this frame
        }
      }
    }
    return drawScene
  }, [draw, engine, engineFailed])
  // Are we previewing through the real engine (pixel-exact) or the stopgap?
  const isRealEngine = draw == null && engine != null && !engineFailed

  // Resolution + timing come from rendering frame 0 once.
  const config = useMemo(() => renderFrame(composition, 0).composition, [composition])
  const totalFrames = Math.max(1, config.duration_in_frames)
  const lastFrame = totalFrames - 1

  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(autoPlay)
  const [loop, setLoop] = useState(initialLoop)

  // Re-draw whenever the frame, composition, or drawer changes.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) paint(ctx, renderFrame(composition, frame))
  }, [composition, frame, paint])

  // Playback paced to the composition's fps via requestAnimationFrame.
  useEffect(() => {
    if (!playing) return
    const frameDuration = 1000 / config.fps
    let last: number | null = null
    let raf = 0
    const tick = (now: number) => {
      if (last === null) last = now
      const steps = Math.floor((now - last) / frameDuration)
      if (steps > 0) {
        last = now
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

  // Stop at the end when not looping.
  useEffect(() => {
    if (!loop && frame >= lastFrame) setPlaying(false)
  }, [frame, lastFrame, loop])

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
    },
    [lastFrame],
  )

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
      }
    },
    [frame, lastFrame, togglePlay, seekTo],
  )

  const seconds = frame / config.fps
  const totalSeconds = lastFrame / config.fps

  // Short corner label + a full description (tooltip) for the engine/preview badge.
  const statusLabel = isRealEngine ? 'Engine' : 'Preview'
  const statusText = isRealEngine
    ? 'Rendered by the real ONDA engine in WebAssembly — no DOM, no Chromium.'
    : engineFailed
      ? `Canvas2D preview — the WASM engine couldn't render this scene (${engineFailed}).`
      : 'Canvas2D preview — shapes exact, text approximate. Pass an engine for pixel-exact output.'

  return (
    <div
      className={['onda-player', playing ? '' : 'is-paused', className].filter(Boolean).join(' ')}
      style={styles.root}
      role="group"
      aria-label={label}
      aria-roledescription="media player"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <ScopedStyles />
      {/* The stage is the positioning context: canvas fills it, controls overlay
          on top (auto-hidden unless hovering / paused / keyboard-focused). */}
      <div
        className="onda-player__stage"
        style={{ ...styles.stage, aspectRatio: `${config.width} / ${config.height}` }}
      >
        <canvas
          ref={canvasRef}
          width={config.width}
          height={config.height}
          className="onda-player__canvas"
          style={styles.canvas}
          onClick={togglePlay}
          aria-label={`composition preview, ${config.width}×${config.height} at ${config.fps}fps — click to ${playing ? 'pause' : 'play'}`}
        />

        {showStatus && (
          <div className="onda-player__badge" title={statusText}>
            <span
              className={`onda-player__dot onda-player__dot--${isRealEngine ? 'ok' : 'warn'}`}
              aria-hidden="true"
            />
            <span>{statusLabel}</span>
          </div>
        )}

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
      </div>
    </div>
  )
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
  },
  canvas: { width: '100%', height: '100%', display: 'block', cursor: 'pointer' },
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

let stylesInjected = false

/** Injects the player's brand-token stylesheet once per document. Using a real
 *  stylesheet (not just inline styles) lets us style `:focus-visible`, `:hover`,
 *  the range thumb/track, and honor `prefers-reduced-motion`. */
function ScopedStyles(): ReactElement | null {
  // Render the <style> only on first mount to avoid duplicate rules.
  const [first] = useState(() => {
    if (stylesInjected) return false
    stylesInjected = true
    return true
  })
  if (!first) return null
  // biome-ignore lint/security/noDangerouslySetInnerHtml: a static, trusted CSS string.
  return <style dangerouslySetInnerHTML={{ __html: PLAYER_CSS }} />
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
  --onda-accent: var(--accent, #d96b82);
  --onda-accent-600: var(--accent-600, #c8576f);
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
.onda-player.is-paused .onda-player__overlay {
  opacity: 1; transform: none; pointer-events: auto;
}
.onda-player__row { display: flex; align-items: center; gap: 14px; }
.onda-player__spacer { flex: 1 1 auto; }
/* Engine/preview badge (top-left), fades with the controls. */
.onda-player__badge {
  position: absolute; top: 12px; left: 12px;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 10px; border-radius: 999px;
  background: rgba(8,8,10,.55); backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,.1);
  color: rgba(255,255,255,.85);
  font-size: 11.5px; font-weight: 500; letter-spacing: 0.02em;
  opacity: 0; transition: opacity 200ms ease-out; pointer-events: none;
}
.onda-player__stage:hover .onda-player__badge,
.onda-player__stage:focus-within .onda-player__badge,
.onda-player.is-paused .onda-player__badge { opacity: 1; }
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
