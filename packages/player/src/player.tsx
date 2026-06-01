//! `<Player>` — an interactive preview of an ONDA composition.

import { renderFrame } from '@onda/react'
import { type CSSProperties, type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import { drawScene } from './canvas-renderer.js'

export interface PlayerProps {
  /** A `<Composition>` element (from `@onda/react`). */
  composition: ReactElement
  autoPlay?: boolean
  loop?: boolean
}

/** Render a composition to a canvas with play/pause and a frame scrubber. Each
 *  visible frame is produced by `@onda/react`'s `renderFrame`, so what you scrub
 *  is the real per-frame scene graph. */
export function Player({ composition, autoPlay = true, loop = true }: PlayerProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Resolution + timing come from rendering frame 0 once.
  const config = useMemo(() => renderFrame(composition, 0).composition, [composition])
  const totalFrames = Math.max(1, config.duration_in_frames)

  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(autoPlay)

  // Re-draw whenever the frame (or composition) changes.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) drawScene(ctx, renderFrame(composition, frame))
  }, [composition, frame])

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
          if (next < totalFrames) return next
          return loop ? next % totalFrames : totalFrames - 1
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, config.fps, totalFrames, loop])

  // Stop at the end when not looping.
  useEffect(() => {
    if (!loop && frame >= totalFrames - 1) setPlaying(false)
  }, [frame, totalFrames, loop])

  return (
    <div style={styles.root}>
      <canvas
        ref={canvasRef}
        width={config.width}
        height={config.height}
        style={styles.canvas}
        aria-label="composition preview"
      />
      <div style={styles.controls}>
        <button type="button" onClick={() => setPlaying((p) => !p)} style={styles.button}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <input
          type="range"
          min={0}
          max={totalFrames - 1}
          value={frame}
          onChange={(event) => {
            setPlaying(false)
            setFrame(Number(event.target.value))
          }}
          style={styles.scrubber}
          aria-label="frame scrubber"
        />
        <span style={styles.readout}>
          {frame} / {totalFrames - 1} · {(frame / config.fps).toFixed(2)}s @ {config.fps}fps
        </span>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: { display: 'inline-block', width: '100%' },
  canvas: { width: '100%', height: 'auto', display: 'block', borderRadius: 8, background: '#000' },
  controls: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 },
  button: { padding: '6px 12px', cursor: 'pointer', minWidth: 96 },
  scrubber: { flex: 1 },
  readout: {
    fontVariantNumeric: 'tabular-nums',
    fontSize: 13,
    color: '#666',
    whiteSpace: 'nowrap',
  },
}
