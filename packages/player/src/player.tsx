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

  return (
    <div
      className={['onda-player', className].filter(Boolean).join(' ')}
      style={styles.root}
      role="group"
      aria-label={label}
      aria-roledescription="media player"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <ScopedStyles />
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
          aria-label={`composition preview, ${config.width}×${config.height} at ${config.fps}fps`}
        />
      </div>

      <div className="onda-player__controls" style={styles.controls}>
        <button
          type="button"
          className="onda-player__btn onda-player__btn--play"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          aria-pressed={playing}
        >
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
          <span className="onda-player__btn-text">{playing ? 'Pause' : 'Play'}</span>
        </button>

        <input
          id={`${uid}-scrubber`}
          type="range"
          className="onda-player__scrubber"
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

        <output
          className="onda-player__readout"
          htmlFor={`${uid}-scrubber`}
          style={styles.readout}
          aria-live="off"
        >
          <span className="onda-player__time">
            {fmtTime(seconds)} / {fmtTime(totalSeconds)}
          </span>
          <span className="onda-player__frames">
            {frame} / {lastFrame}
          </span>
        </output>

        <button
          type="button"
          className={`onda-player__btn onda-player__btn--loop${loop ? ' is-active' : ''}`}
          onClick={() => setLoop((v) => !v)}
          aria-label="Loop playback"
          aria-pressed={loop}
          title="Loop"
        >
          <span aria-hidden="true">↻</span>
          <span className="onda-player__btn-text">Loop</span>
        </button>
      </div>

      {showStatus && (
        <p className="onda-player__status" style={styles.status}>
          {isRealEngine ? (
            <>
              <span className="onda-player__dot onda-player__dot--ok" aria-hidden="true" />
              <strong>Engine:</strong> the real Rust renderer (cosmic-text + Open Sans) in
              WebAssembly — pixel-identical to <code>onda export</code>. No DOM, no Chromium.
            </>
          ) : engineFailed ? (
            <>
              <span className="onda-player__dot onda-player__dot--warn" aria-hidden="true" />
              <strong>Preview (engine fell back):</strong> the WASM engine couldn't render this
              scene (<code>{engineFailed}</code>), so this is the Canvas2D preview.
            </>
          ) : (
            <>
              <span className="onda-player__dot onda-player__dot--warn" aria-hidden="true" />
              <strong>Preview:</strong> Canvas2D with the browser font (shapes exact, text
              approximate). Pass <code>engine</code> for the pixel-exact renderer.
            </>
          )}
        </p>
      )}
    </div>
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
    color: 'var(--onda-text, #e8edf7)',
    fontFamily: 'var(--onda-font-body, "Inter", ui-sans-serif, system-ui, sans-serif)',
  },
  stage: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    background: '#000',
    border: '1px solid var(--onda-border, #232a3a)',
  },
  canvas: { width: '100%', height: '100%', display: 'block' },
  controls: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 },
  readout: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.2,
    fontVariantNumeric: 'tabular-nums',
    fontSize: 13,
    color: 'var(--onda-text-muted, #93a0b8)',
    whiteSpace: 'nowrap',
  },
  status: {
    marginTop: 10,
    fontSize: 13,
    color: 'var(--onda-text-muted, #93a0b8)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
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
  /* Brand tokens (see assets/brand/BRAND.md) with safe fallbacks. */
  --onda-bg: var(--bg, #080b13);
  --onda-surface: var(--surface, #11151f);
  --onda-surface-2: var(--surface-2, #1a1f2e);
  --onda-border: var(--border, #232a3a);
  --onda-text: var(--text, #e8edf7);
  --onda-text-muted: var(--text-muted, #93a0b8);
  --onda-primary: var(--primary, #3b82f6);
  --onda-primary-700: var(--primary-700, #2563eb);
  --onda-cyan: var(--cyan, #22d3ee);
  --onda-ok: var(--ok, #28c08a);
  --onda-warn: var(--warn, #fac81c);
  --onda-radius: 8px;
}
.onda-player__btn {
  display: inline-flex; align-items: center; gap: 8px;
  min-height: 40px; padding: 0 16px;
  border-radius: var(--onda-radius);
  border: 1px solid var(--onda-border);
  background: var(--onda-surface-2);
  color: var(--onda-text);
  font: inherit; font-size: 14px; font-weight: 500;
  cursor: pointer;
  transition: background 180ms ease-out, border-color 180ms ease-out, color 180ms ease-out;
}
.onda-player__btn:hover { background: var(--onda-border); }
.onda-player__btn:active { transform: translateY(0.5px); }
.onda-player__btn--play {
  background: var(--onda-primary);
  border-color: var(--onda-primary);
  color: var(--on-primary, #fff);
  min-width: 104px;
}
.onda-player__btn--play:hover { background: var(--onda-primary-700); border-color: var(--onda-primary-700); }
.onda-player__btn--loop.is-active {
  color: var(--onda-cyan);
  border-color: color-mix(in srgb, var(--onda-cyan) 50%, var(--onda-border));
}
.onda-player__btn--loop.is-active span[aria-hidden] { color: var(--onda-cyan); }
/* Visible focus rings on every interactive control + the player region. */
.onda-player:focus-visible,
.onda-player__btn:focus-visible,
.onda-player__scrubber:focus-visible {
  outline: 2px solid var(--onda-cyan);
  outline-offset: 2px;
}
.onda-player__scrubber {
  flex: 1; min-width: 80px;
  height: 6px; cursor: pointer;
  -webkit-appearance: none; appearance: none;
  background: var(--onda-surface-2);
  border-radius: 999px;
  accent-color: var(--onda-primary);
}
.onda-player__scrubber::-webkit-slider-runnable-track {
  height: 6px; border-radius: 999px;
  background: linear-gradient(90deg, var(--onda-primary), var(--onda-cyan));
}
.onda-player__scrubber::-moz-range-track {
  height: 6px; border-radius: 999px;
  background: linear-gradient(90deg, var(--onda-primary), var(--onda-cyan));
}
.onda-player__scrubber::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px; margin-top: -5px;
  border-radius: 999px; background: var(--onda-text);
  border: 2px solid var(--onda-primary);
  box-shadow: 0 1px 4px rgba(0,0,0,.5);
}
.onda-player__scrubber::-moz-range-thumb {
  width: 16px; height: 16px;
  border-radius: 999px; background: var(--onda-text);
  border: 2px solid var(--onda-primary);
}
.onda-player__time { font-weight: 600; color: var(--onda-text); }
.onda-player__dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
.onda-player__dot--ok { background: var(--onda-ok); }
.onda-player__dot--warn { background: var(--onda-warn); }
.onda-player__status code, .onda-player__status strong { color: var(--onda-text); }
.onda-player__status code {
  font-family: var(--onda-font-mono, "JetBrains Mono", ui-monospace, monospace);
  font-size: 12px;
}
@media (max-width: 480px) {
  .onda-player__btn-text { display: none; }
  .onda-player__btn { min-width: 0; padding: 0 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .onda-player__btn { transition: none; }
  .onda-player__btn:active { transform: none; }
}
`
